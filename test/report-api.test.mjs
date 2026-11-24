import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_API_URL } from "../extension/reply.mjs";

test("submit-report posts the link and reporter, and maps failures", async t => {
  let listener;
  const noop = { addListener() {} };
  const requests = [];
  const store = {};
  let status = 200;
  let reply = { ok: true, message: "Thanks" };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(reply), { status });
  });
  globalThis.chrome = {
    alarms: { get: async () => ({}), onAlarm: noop },
    contextMenus: { onClicked: noop },
    runtime: { id: "x", onInstalled: noop, onStartup: noop, onMessage: { addListener: fn => { listener = fn; } }, getURL: n => n },
    tabs: { onRemoved: noop },
    storage: {
      local: {
        get: async () => ({ reviewedList: { handles: ["listed"] }, reporterUsername: "me_1", ...store }),
        set: async values => Object.assign(store, values)
      },
      session: {}
    }
  };
  await import("../extension/background.mjs");
  const send = url => new Promise(resolve => listener({ type: "submit-report", url }, { id: "x" }, resolve));
  const post = "https://x.com/Spammer/status/1";

  assert.deepEqual(await send(post), { ok: true, message: "Thanks" });
  assert.equal(requests[0].url, REPORT_API_URL);
  assert.deepEqual(JSON.parse(requests[0].options.body), { tweet_url: post, reporter: "me_1" });

  assert.equal(store.reportHistory.length, 1);
  assert.match((await send(post)).error, /wait \d+s/);
  assert.equal(requests.length, 1);
  store.reportHistory = [Date.now() - 10_000];

  assert.equal((await send("https://x.com/listed/status/2")).ok, false);
  assert.equal(requests.length, 1);

  store.reportHistory = Array(20).fill(Date.now() - 10_000);
  assert.match((await send(post)).error, /Hourly report limit reached/);
  assert.equal(requests.length, 1);
  store.reportHistory = [Date.now() - 10_000];

  status = 429;
  reply = { ok: false, error: "slow", retry_after: 120 };
  assert.deepEqual(await send(post), { ok: false, error: "Report limit reached. Try again in 2 min." });

  assert.equal(store.reportHistory.length, 20);
  store.reportHistory = [];

  status = 400;
  reply = { ok: false, error: "Invalid post." };
  assert.deepEqual(await send(post), { ok: false, fallback: false, error: "Invalid post." });

  reply = { ok: false, error: "Please complete the human check, then send again." };
  assert.deepEqual(await send(post), {
    ok: false, fallback: true, error: "Please complete the human check, then send again."
  });

  status = 401;
  reply = { ok: false, error: "API key required." };
  assert.equal((await send(post)).fallback, true);

  status = 403;
  reply = { ok: false, error: "Forbidden." };
  assert.equal((await send(post)).fallback, true);

  status = 503;
  reply = { ok: false };
  assert.equal((await send(post)).fallback, true);
});
