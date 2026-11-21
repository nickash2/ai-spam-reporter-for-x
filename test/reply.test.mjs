import assert from "node:assert/strict";
import test from "node:test";
import { parsePostLink, parseUsernameFeed } from "../extension/reply.mjs";

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
