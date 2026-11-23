import "./post-link.js";

export const REPORT_URL = "https://blockedforaireply.com/";
export const FEED_URL = new URL("api/usernames.txt", REPORT_URL).href;
export const CACHE_KEY = "reviewedList";
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
