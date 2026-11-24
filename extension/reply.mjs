import "./post-link.js";

export const REPORT_URL = "https://blockedforaireply.com/";
export const REPORT_API_URL = new URL("api/report.php", REPORT_URL).href;
export const REPORTER_KEY = "reporterUsername";
export const REPORT_HISTORY_KEY = "reportHistory";
export const REPORT_LIMIT = 20;
export const REPORT_WINDOW_MS = 60 * 60 * 1000;
export const REPORT_COOLDOWN_MS = 5000;
export const FEED_URL = new URL("api/usernames.txt", REPORT_URL).href;
export const REMOVED_FEED_URL = new URL("api/removed.json", REPORT_URL).href;
export const CACHE_KEY = "reviewedList";
export const REMOVED_CACHE_KEY = "removedAccounts";
export const REMOVED_SYNC_KEY = "removedAccountsSyncIssue";
export const SYNC_KEY = "reviewedListSyncIssue";
export const INLINE_KEY = "showInlineControls";
export const REMOVED_TAG_KEY = "showPreviouslyBlocked";
export const HIDE_KEY = "hideBlockedAccounts";
export const REMOVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const { parsePostLink } = globalThis.replyReportLinks;

export function normalizeReporter(value) {
  const handle = String(value ?? "").trim().replace(/^@/, "");
  if (!handle) return "";
  return globalThis.replyReportLinks.handlePattern.test(handle) ? handle : null;
}

export function parseUsernameFeed(body) {
  const handles = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!handles.length || handles.some(handle => !globalThis.replyReportLinks.handlePattern.test(handle))) {
    throw new Error("The server did not return a valid username list.");
  }

  return [...new Set(handles.map(handle => handle.toLowerCase()))].sort();
}

function validRemovedDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
    !validRemovedDate(account.removed)
  )) {
    throw new Error("The server did not return valid removed-account data.");
  }

  const cutoff = now - REMOVED_RETENTION_MS;
  const recentAccounts = new Map();
  for (const account of feed.accounts) {
    const removedAt = Date.parse(account.removed);
    if (removedAt < cutoff || removedAt > now) continue;

    const username = account.username.toLowerCase();
    const current = recentAccounts.get(username);
    if (!current || account.removed > current.removed) {
      recentAccounts.set(username, { username, removed: account.removed });
    }
  }
  return [...recentAccounts.values()].sort((a, b) => a.username.localeCompare(b.username));
}

export function reportQuota(history, now = Date.now()) {
  const recent = (Array.isArray(history) ? history : []).filter(time => Number.isFinite(time) && now - time < REPORT_WINDOW_MS);
  const used = recent.length;
  const last = Math.max(0, ...recent);
  return {
    recent,
    used,
    limit: REPORT_LIMIT,
    resetMs: used ? Math.min(...recent) + REPORT_WINDOW_MS - now : 0,
    cooldownMs: Math.max(0, last + REPORT_COOLDOWN_MS - now)
  };
}
