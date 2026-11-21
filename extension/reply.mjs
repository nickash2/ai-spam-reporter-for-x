import "./post-link.js";

export const REPORT_URL = "https://blockedforaireply.levels.io/";
export const FEED_URL = new URL("api/usernames.txt", REPORT_URL).href;
export const CACHE_KEY = "reviewedList";
export const SYNC_KEY = "reviewedListSyncIssue";
export const INLINE_KEY = "showInlineControls";
export const { parsePostLink } = globalThis.replyReportLinks;

export function parseUsernameFeed(body) {
  const handles = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!handles.length || handles.some(handle => !globalThis.replyReportLinks.handlePattern.test(handle))) {
    throw new Error("The server did not return a valid username list.");
  }

  return [...new Set(handles.map(handle => handle.toLowerCase()))].sort();
}
