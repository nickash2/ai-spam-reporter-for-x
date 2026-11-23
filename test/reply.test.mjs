import assert from "node:assert/strict";
import test from "node:test";
import {
  findNewerRelease, parsePostLink, parseRemovedFeed, parseUsernameFeed, REMOVED_RETENTION_MS
} from "../extension/reply.mjs";

test("preserves the exact post ID and removes tracking and media suffixes", () => {
  assert.deepEqual(
    parsePostLink("https://twitter.com/Some_User/status/2123920308126060726/photo/1?s=20#reply"),
    { handle: "Some_User", url: "https://x.com/Some_User/status/2123920308126060726" }
  );
});

test("rejects links that do not identify a post and its author on X", () => {
  for (const url of [
    null,
    "https://x.com/Some_User",
    "https://x.com/i/web/status/123",
    "https://x.com/i/status/123",
    "https://x.com/messages/status/123",
    "https://x.com/Some_User/status/123/quotes",
    "https://x.com/Some_User/status/0",
    "https://x.com.example.org/Some_User/status/123",
    "https://example.org/?https://x.com/Some_User/status/123",
    "https://example.org@x.com/Some_User/status/123",
    "http://x.com/Some_User/status/123"
  ]) {
    assert.equal(parsePostLink(url), null, String(url));
  }
});

test("normalizes and deduplicates handles across line-ending formats", () => {
  assert.deepEqual(parseUsernameFeed("\uFEFF BOB \r\nAlice\nalice\n\n"), ["alice", "bob"]);
});

test("rejects empty, partially malformed, and HTML feeds", () => {
  for (const body of ["\r\n", "valid\n@invalid", "<html>Upstream error</html>"]) {
    assert.throws(() => parseUsernameFeed(body), /valid username list/);
  }
});

test("parses recent removed accounts independently of the active username list", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  assert.deepEqual(parseRemovedFeed(JSON.stringify({
    accounts: [
      { username: "Recent_Removed", removed: "2026-11-21" },
      { username: "Expired", removed: new Date(now - REMOVED_RETENTION_MS - 86_400_000).toISOString().slice(0, 10) },
      { username: "recent_removed", removed: "2026-11-22" }
    ]
  }), now), [{ username: "recent_removed", removed: "2026-11-22" }]);
});

test("rejects invalid removed-account data", () => {
  for (const body of [
    "<html>Unavailable</html>",
    "{}",
    '{"accounts":[{"username":"@invalid","removed":"2026-11-21"}]}',
    '{"accounts":[{"username":"invalid","removed":"2026-02-30"}]}'
  ]) {
    assert.throws(() => parseRemovedFeed(body), /valid removed-account data/);
  }
});

test("links to a newer GitHub release download, but not the installed or an older version", () => {
  const release = {
    tag_name: "v1.5.0",
    assets: [{
      name: "ai-spam-reporter-extension-v1.5.0.zip",
      browser_download_url: "https://github.com/nickash2/ai-spam-reporter-for-x/releases/download/v1.5.0/ai-spam-reporter-extension-v1.5.0.zip"
    }]
  };
  assert.deepEqual(findNewerRelease(release, "1.4.4"), {
    version: "1.5.0",
    url: release.assets[0].browser_download_url
  });
  assert.equal(findNewerRelease(release, "1.5.0"), null);
  assert.equal(findNewerRelease(release, "1.5.0.0"), null);
  assert.equal(findNewerRelease(release, "1.6.0"), null);
});

test("rejects GitHub releases with invalid versions or download URLs", () => {
  assert.throws(() => findNewerRelease({ tag_name: "latest" }, "1.4.4"), /valid extension version/);
  assert.throws(() => findNewerRelease({
    tag_name: "v1.5.0",
    assets: [{
      name: "ai-spam-reporter-extension-v1.5.0.zip",
      browser_download_url: "https://example.org/download.zip"
    }]
  }, "1.4.4"), /valid extension download/);
});
