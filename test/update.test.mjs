import assert from "node:assert/strict";
import test from "node:test";
import {
  CACHE_KEY, HIDE_KEY, INLINE_KEY, REMOVED_TAG_KEY, SYNC_KEY
} from "../extension/reply.mjs";

test("manual update check forces a new check and shows the release download", async () => {
  const elements = new Map();
  const changes = { addListener() {} };
  const cached = {
    [CACHE_KEY]: { handles: [], updatedAt: Date.now() },
    [HIDE_KEY]: false,
    [INLINE_KEY]: true,
    [REMOVED_TAG_KEY]: true,
    [SYNC_KEY]: null
  };
  const messages = [];
  const release = {
    tag_name: "v1.5.0",
    assets: [{
      name: "ai-spam-reporter-extension-v1.5.0.zip",
      browser_download_url: "https://github.com/nickash2/ai-spam-reporter-for-x/releases/download/v1.5.0/ai-spam-reporter-extension-v1.5.0.zip"
    }]
  };

  globalThis.window = {
    location: { href: "chrome-extension://test-extension/review.html?post=https%3A%2F%2Fx.com%2FExample%2Fstatus%2F1" }
  };
  globalThis.document = {
    querySelector(selector) {
      if (!elements.has(selector)) {
        elements.set(selector, {
          dataset: {},
          listeners: {},
          addEventListener(type, listener) { this.listeners[type] = listener; },
          removeAttribute(name) { delete this[name]; }
        });
      }
      return elements.get(selector);
    }
  };
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: "1.4.4" }),
      sendMessage: async message => {
        messages.push(message);
        return message.force
          ? { ok: true, update: { version: "1.5.0", url: release.assets[0].browser_download_url } }
          : { ok: true, update: null };
      }
    },
    storage: {
      onChanged: changes,
      local: {
        get: async keys => Array.isArray(keys)
          ? Object.fromEntries(keys.map(key => [key, cached[key]]))
          : { [keys]: cached[keys] },
        set: async values => Object.assign(cached, values)
      }
    }
  };

  await import(`../extension/review.mjs?update-test=${Date.now()}`);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(messages, [{ type: "check-updates", force: false }]);
  assert.equal(elements.get("#version-label").textContent, "Version 1.4.4");
  assert.equal(elements.get("#update-status").textContent, "You're up to date.");

  await elements.get("#update-refresh").listeners.click();
  assert.deepEqual(messages[1], { type: "check-updates", force: true });
  assert.equal(elements.get("#update-link").hidden, false);
  assert.equal(elements.get("#update-link").textContent, "Download v1.5.0");
  assert.equal(elements.get("#update-link").href, release.assets[0].browser_download_url);
});
