import assert from "node:assert/strict";
import test from "node:test";
import {
  CACHE_KEY, FEED_URL, RELEASES_API_URL, REMOVED_CACHE_KEY, REMOVED_FEED_URL, REPORT_URL,
  SYNC_KEY, UPDATE_CACHE_KEY
} from "../extension/reply.mjs";

function event() {
  return { addListener(listener) { this.listener = listener; } };
}

test("hourly alarm checks GitHub even when the update cache is fresh", async t => {
  const onAlarm = event();
  const onRemoved = event();
  const stored = {
    [CACHE_KEY]: { handles: ["active_user"], updatedAt: Date.now() },
    [REMOVED_CACHE_KEY]: { handles: [], updatedAt: Date.now() },
    [SYNC_KEY]: null,
    [UPDATE_CACHE_KEY]: { checkedAt: Date.now(), installedVersion: "1.4.4", update: null }
  };
  const release = {
    tag_name: "v1.5.0",
    assets: [{
      name: "ai-spam-reporter-extension-v1.5.0.zip",
      browser_download_url: "https://github.com/nickash2/ai-spam-reporter-for-x/releases/download/v1.5.0/ai-spam-reporter-extension-v1.5.0.zip"
    }]
  };
  let releaseChecks = 0;

  t.mock.method(globalThis, "fetch", async url => {
    if (url === FEED_URL) return new Response("Active_User");
    if (url === REMOVED_FEED_URL) return new Response(JSON.stringify({ accounts: [] }));
    assert.equal(url, RELEASES_API_URL);
    releaseChecks++;
    return new Response(JSON.stringify(release), { headers: { "content-type": "application/json" } });
  });
  globalThis.chrome = {
    alarms: { get: async () => ({ name: "refresh-reviewed-list" }), onAlarm, create: async () => {} },
    contextMenus: { onClicked: event(), removeAll: callback => callback(), create: () => {} },
    runtime: {
      id: "test-extension",
      getManifest: () => ({ version: "1.4.4" }),
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(),
      getURL: name => `chrome-extension://test-extension/${name}`
    },
    tabs: { onRemoved, create: async () => ({ id: 1 }), update: async () => {} },
    storage: {
      local: {
        get: async keys => Array.isArray(keys)
          ? Object.fromEntries(keys.map(key => [key, stored[key]]))
          : { [keys]: stored[keys] },
        set: async values => Object.assign(stored, values)
      },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} }
    }
  };

  await import(`../extension/background.mjs?hourly-update-test=${Date.now()}`);
  await onAlarm.listener({ name: "refresh-reviewed-list" });

  assert.equal(releaseChecks, 1);
  assert.deepEqual(stored[UPDATE_CACHE_KEY].update, {
    version: "1.5.0",
    url: release.assets[0].browser_download_url
  });
});
