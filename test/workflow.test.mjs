import assert from "node:assert/strict";
import test from "node:test";
import { CACHE_KEY, FEED_URL, REPORT_URL, SYNC_KEY } from "../extension/reply.mjs";

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
  let body = "Some_User\nOther_User";
  let downloads = 0;

  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, FEED_URL);
    assert.equal(options.credentials, "omit");
    downloads++;
    return new Response(body);
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
        get: async () => ({ [CACHE_KEY]: cache, [SYNC_KEY]: syncIssue }),
        set: async values => {
          if (CACHE_KEY in values) cache = values[CACHE_KEY];
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

  assert.deepEqual(await Promise.all([refresh(), refresh()]), [{ ok: true }, { ok: true }]);
  assert.equal(downloads, 1);
  assert.deepEqual(cache.handles, ["other_user", "some_user"]);
  const firstCache = cache;
  assert.equal((await send({ type: "open-report", url: postUrl })).ok, false);
  assert.deepEqual(opened, []);

  body = "<html>Unavailable</html>";
  assert.equal((await refresh()).ok, false);
  assert.equal(cache, firstCache);
  assert.equal(syncIssue.type, "failed");

  const fullList = Array.from({ length: 110 }, (_, i) => `account_${i}`);
  body = fullList.join("\n");
  assert.deepEqual(await refresh(), { ok: true });
  assert.equal(syncIssue, null);

  body = "Truncated_User";
  assert.deepEqual(await refresh(), { ok: false, reason: "drop" });
  assert.equal(cache.handles.length, 110);
  assert.equal(syncIssue.count, 1);

  const review = { url: "chrome-extension://test-extension/review.html" };
  const confirmDrop = digest => send({ type: "accept-list-drop", digest }, review);
  const firstDigest = syncIssue.digest;
  body = "Other_User";
  assert.deepEqual(await confirmDrop(firstDigest), { ok: false, reason: "drop" });
  assert.equal(cache.handles.length, 110);
  assert.deepEqual(await confirmDrop(syncIssue.digest), { ok: true });
  assert.deepEqual(await refresh(), { ok: true });
  assert.deepEqual(cache.handles, ["other_user"]);

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
      local: { get: async () => ({ [CACHE_KEY]: { handles: ["some_user"], updatedAt: Date.now() } }) }
    },
    runtime: { sendMessage: async message => { opened.push(message); return { ok: true }; } }
  };
  await import("../extension/review.mjs");

  assert.equal(controls["#handle"].textContent, "@Some_User");
  assert.equal(controls["#report"].disabled, true);
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
  await controls["#report"].listener();
  assert.deepEqual(opened, [{ type: "open-report", url: postUrl }]);
  await controls["#copy"].listener();
  assert.deepEqual(copied, [postUrl]);
});
