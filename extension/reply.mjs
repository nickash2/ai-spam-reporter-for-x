import "./post-link.js";

export const REPORT_URL = "https://blockedforaireply.com/";
export const FEED_URL = new URL("api/usernames.txt", REPORT_URL).href;
export const REMOVED_FEED_URL = new URL("api/removed.json", REPORT_URL).href;
export const CACHE_KEY = "reviewedList";
export const REMOVED_CACHE_KEY = "removedAccounts";
export const SYNC_KEY = "reviewedListSyncIssue";
export const INLINE_KEY = "showInlineControls";
export const REMOVED_TAG_KEY = "showPreviouslyBlocked";
export const HIDE_KEY = "hideBlockedAccounts";
export const REMOVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const { parsePostLink } = globalThis.replyReportLinks;

export function parseUsernameFeed(body) {
  const handles = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!handles.length || handles.some(handle => !globalThis.replyReportLinks.handlePattern.test(handle))) {
    throw new Error("The server did not return a valid username list.");
  }

  return [...new Set(handles.map(handle => handle.toLowerCase()))].sort();
}

export function parseRemovedFeed(body, now = Date.now()) {
  let feed;
  try {
    feed = JSON.parse(body);
  } catch {
    throw new Error("The server did not return valid removed-account data.");
  }
  if (!Array.isArray(feed?.accounts) || feed.accounts.some(account =>
    typeof account?.username !== "string" ||
    !globalThis.replyReportLinks.handlePattern.test(account.username) ||
    typeof account.removed !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(account.removed) ||
    !Number.isFinite(Date.parse(account.removed))
  )) {
    throw new Error("The server did not return valid removed-account data.");
  }

  const cutoff = now - REMOVED_RETENTION_MS;
  return [...new Set(feed.accounts
    .filter(account => {
      const removedAt = Date.parse(account.removed);
      return removedAt >= cutoff && removedAt <= now;
    })
    .map(account => account.username.toLowerCase()))].sort();
}
