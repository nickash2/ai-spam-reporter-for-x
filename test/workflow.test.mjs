import assert from "node:assert/strict";
import test from "node:test";
import {
  CACHE_KEY, FEED_URL, REMOVED_CACHE_KEY, REMOVED_FEED_URL, REMOVED_SYNC_KEY, REPORT_URL, SYNC_KEY
} from "../extension/reply.mjs";

function event() {
  return { addListener(listener) { this.listener = listener; } };
}

test("worker keeps the last good list on failure and replaces it on recovery", async t => {
  const onMessage = event();
  const onClicked = event();
  const opened = [];
  const pending = {};
  const onRemoved = event();
  let syncIssue;
  let cache;
  let removedCache;
  let removedSyncIssue;
  let body = "Some_User\nOther_User";
  const removedBody = JSON.stringify({ accounts: [{ username: "Earlier_User", removed: new Date().toISOString().slice(0, 10) }] });
  let removedUnavailable = false;
  let downloads = 0;

  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.credentials, "omit");
    if (url === FEED_URL) {
      downloads++;
      return new Response(body);
    }
    assert.equal(url, REMOVED_FEED_URL);
    if (removedUnavailable) return new Response("Unavailable", { status: 503 });
    return new Response(removedBody);
  });
  globalThis.chrome = {
    alarms: { get: async () => ({ name: "existing" }), onAlarm: event() },
    contextMenus: { onClicked },
    runtime: {
      id: "test-extension",
      onInstalled: event(),
      onStartup: event(),
      onMessage,
      getURL: name => `chrome-extension://test-extension/${name}`
    },
    tabs: {
      onRemoved,
      create: async ({ url }) => { opened.push(url); return { id: 42 }; },
      update: async (id, { url }) => {
        assert.equal(id, 42);
        assert.equal(pending["reportDraft:42"], "https://x.com/Some_User/status/222");
        opened.push(url);
      }
    },
    storage: {
      local: {
        get: async () => ({
          [CACHE_KEY]: cache, [REMOVED_CACHE_KEY]: removedCache, [REMOVED_SYNC_KEY]: removedSyncIssue, [SYNC_KEY]: syncIssue
        }),
        set: async values => {
          if (CACHE_KEY in values) cache = values[CACHE_KEY];
          if (REMOVED_CACHE_KEY in values) removedCache = values[REMOVED_CACHE_KEY];
          if (REMOVED_SYNC_KEY in values) removedSyncIssue = values[REMOVED_SYNC_KEY];
          if (SYNC_KEY in values) syncIssue = values[SYNC_KEY];
        }
      },
      session: {
        get: async key => ({ [key]: pending[key] }),
        set: async values => Object.assign(pending, values),
        remove: async key => { delete pending[key]; }
      }
    }
  };
  await import("../extension/background.mjs");

  function send(message, sender = {}) {
    return new Promise(resolve => {
      assert.equal(onMessage.listener(message, { id: "test-extension", ...sender }, resolve), true);
    });
  }

  const refresh = () => send({ type: "refresh-list" });
  const postUrl = "https://x.com/Some_User/status/222";

  assert.deepEqual(await Promise.all([refresh(), refresh()]), [
    { ok: true, removedOk: true }, { ok: true, removedOk: true }
  ]);
  assert.equal(downloads, 1);
  assert.deepEqual(cache.handles, ["other_user", "some_user"]);
  assert.deepEqual(removedCache.handles, ["earlier_user"]);
  assert.equal(removedCache.removedAt.earlier_user, JSON.parse(removedBody).accounts[0].removed);
  assert.equal(removedSyncIssue, null);
  const firstCache = cache;
  assert.deepEqual(await send({ type: "open-report", url: postUrl }), {
    ok: false,
    error: "This account is already on the blocklist."
  });
  assert.deepEqual(opened, []);

  body = "<html>Unavailable</html>";
  assert.equal((await refresh()).ok, false);
  assert.equal(cache, firstCache);
  assert.equal(syncIssue.type, "failed");

  const fullList = Array.from({ length: 110 }, (_, i) => `account_${i}`);
  body = fullList.join("\n");
  assert.deepEqual(await refresh(), { ok: true, removedOk: true });
  assert.equal(syncIssue, null);

  body = "Truncated_User";
  assert.deepEqual(await refresh(), { ok: false, reason: "drop", removedOk: true });
  assert.equal(cache.handles.length, 110);
  assert.equal(syncIssue.count, 1);

  const review = { url: "chrome-extension://test-extension/review.html" };
  const confirmDrop = digest => send({ type: "accept-list-drop", digest }, review);
  const firstDigest = syncIssue.digest;
  body = "Other_User";
  assert.deepEqual(await confirmDrop(firstDigest), { ok: false, reason: "drop", removedOk: true });
  assert.equal(cache.handles.length, 110);
  assert.deepEqual(await confirmDrop(syncIssue.digest), { ok: true, removedOk: true });
  assert.deepEqual(await refresh(), { ok: true, removedOk: true });
  assert.deepEqual(cache.handles, ["other_user"]);

  const lastRemovedCache = removedCache;
  removedUnavailable = true;
  assert.deepEqual(await refresh(), { ok: true, removedOk: false });
  assert.equal(removedCache, lastRemovedCache);
  assert.equal(removedSyncIssue.type, "failed");
  removedUnavailable = false;
  assert.deepEqual(await refresh(), { ok: true, removedOk: true });
  assert.equal(removedSyncIssue, null);

  onClicked.listener({
    menuItemId: "review-reply-link",
    pageUrl: "https://x.com/Parent/status/111",
    linkUrl: "https://x.com/Some_User/status/222?s=20"
  });
  assert.equal(new URL(opened[0]).searchParams.get("post"), postUrl);

  assert.deepEqual(await send({ type: "open-report", url: postUrl }), { ok: true });
  assert.deepEqual(opened.slice(1), ["about:blank", REPORT_URL]);
  const otherTab = { url: REPORT_URL, tab: { id: 43 } };
  const reportTab = { url: REPORT_URL, tab: { id: 42 } };
  assert.deepEqual(await send({ type: "report-draft" }, otherTab), { ok: true });
  assert.deepEqual(await send({ type: "report-draft" }, reportTab), { ok: true, url: postUrl });
  assert.deepEqual(await send({ type: "report-draft" }, reportTab), { ok: true, url: postUrl });
  onRemoved.listener(42);
  assert.deepEqual(await send({ type: "report-draft" }, reportTab), { ok: true });
});

test("review action opens the selected permalink after a list removal and offers a copy fallback", async t => {
  const controls = {};
  const changes = event();
  const opened = [];
  const copied = [];
  const postUrl = "https://x.com/Some_User/status/222";
  const draftUrl = new URL("chrome-extension://test-extension/review.html");
  draftUrl.searchParams.set("post", postUrl);

  globalThis.window = { location: { href: draftUrl.href } };
  globalThis.document = {
    querySelector: selector => (controls[selector] ??= { dataset: {}, addEventListener(_type, listener) { this.listener = listener; } })
  };
  t.mock.getter(globalThis, "navigator", () => ({
    clipboard: { writeText: async value => { copied.push(value); } }
  }));
  globalThis.chrome = {
    storage: {
      onChanged: changes,
      local: {
        get: async () => ({
          [CACHE_KEY]: { handles: ["some_user"], updatedAt: Date.now() },
          [REMOVED_CACHE_KEY]: {
            handles: ["former_user"],
            removedAt: { former_user: "2026-11-20" },
            updatedAt: Date.now() - 60_000
          },
          [REMOVED_SYNC_KEY]: { type: "failed" }
        })
      }
    },
    runtime: { sendMessage: async message => { opened.push(message); return { ok: true }; } }
  };
  await import("../extension/review.mjs");

  assert.equal(controls["#handle"].textContent, "@Some_User");
  assert.equal(controls["#report"].disabled, true);
  assert.match(controls["#removed-freshness"].textContent, /sync failed; last synced/);
  assert.equal(controls["#removed-freshness"].dataset.state, "failed");
  await controls["#report"].listener();
  assert.deepEqual(opened, []);

  changes.listener({ [CACHE_KEY]: { newValue: { handles: ["other_user"], updatedAt: Date.now() } } }, "local");
  assert.equal(controls["#report"].disabled, false);
  assert.equal(controls["#membership"].textContent, "No match in the synced list");
  changes.listener({ [SYNC_KEY]: { newValue: { type: "failed" } } }, "local");
  assert.equal(controls["#sync-detail"].textContent, "Sync failed. Using last synced list.");
  assert.equal(controls["#sync-warning"].hidden, false);
  changes.listener({ [SYNC_KEY]: { newValue: null } }, "local");
  assert.equal(controls["#sync-warning"].hidden, true);
  changes.listener({
    [REMOVED_SYNC_KEY]: { newValue: null },
    [REMOVED_CACHE_KEY]: {
      newValue: { handles: ["former_user"], removedAt: { former_user: "2026-11-20" }, updatedAt: Date.now() }
    }
  }, "local");
  assert.match(controls["#removed-freshness"].textContent, /Previously blocked: Synced/);
  assert.equal(controls["#removed-freshness"].dataset.state, "");
  await controls["#report"].listener();
  assert.deepEqual(opened, [{ type: "open-report", url: postUrl }]);
  await controls["#copy"].listener();
  assert.deepEqual(copied, [postUrl]);
});
