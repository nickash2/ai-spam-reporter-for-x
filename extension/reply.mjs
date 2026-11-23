import "./post-link.js";

export const REPORT_URL = "https://blockedforaireply.com/";
export const FEED_URL = new URL("api/usernames.txt", REPORT_URL).href;
export const REMOVED_FEED_URL = new URL("api/removed.json", REPORT_URL).href;
export const RELEASES_API_URL = "https://api.github.com/repos/nickash2/ai-spam-reporter-for-x/releases/latest";
export const UPDATE_CACHE_KEY = "extensionUpdateCheck";
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
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
