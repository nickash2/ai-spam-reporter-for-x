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
export const RELEASES_API_URL = "https://api.github.com/repos/nickash2/ai-spam-reporter-for-x/releases/latest";
export const UPDATE_CACHE_KEY = "extensionUpdateCheck";
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
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

function versionParts(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+){0,3}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  return parts.every(part => Number.isInteger(part) && part <= 65535) ? parts : null;
}

export function findNewerRelease(release, installedVersion) {
  const tag = typeof release?.tag_name === "string" ? /^v(.+)$/.exec(release.tag_name)?.[1] : null;
  const installed = versionParts(installedVersion);
  const latest = versionParts(tag);
  if (!installed || !latest) throw new Error("GitHub did not return a valid extension version.");

  let comparison = 0;
  for (let index = 0; index < Math.max(installed.length, latest.length); index++) {
    const currentPart = installed[index] ?? 0;
    const latestPart = latest[index] ?? 0;
    if (latestPart !== currentPart) {
      comparison = latestPart > currentPart ? 1 : -1;
      break;
    }
  }
  if (comparison <= 0) return null;

  const assetName = `ai-spam-reporter-extension-${release.tag_name}.zip`;
  const asset = release.assets?.find(candidate => candidate.name === assetName);
  let downloadUrl;
  try {
    downloadUrl = new URL(asset?.browser_download_url);
  } catch {
    throw new Error("The latest GitHub release does not include a valid extension download.");
  }
  const expectedPath = `/nickash2/ai-spam-reporter-for-x/releases/download/${release.tag_name}/${assetName}`;
  if (downloadUrl.origin !== "https://github.com" || downloadUrl.pathname !== expectedPath) {
    throw new Error("The latest GitHub release does not include a valid extension download.");
  }

  return { version: latest.join("."), url: downloadUrl.href };
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
