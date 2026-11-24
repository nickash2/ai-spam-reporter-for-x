import {
  CACHE_KEY, HIDE_KEY, INLINE_KEY, REMOVED_CACHE_KEY, REMOVED_SYNC_KEY, REMOVED_TAG_KEY, REPORTER_KEY, SYNC_KEY,
  UPDATE_CACHE_KEY, normalizeReporter, parsePostLink
} from "./reply.mjs";

const guidance = document.querySelector("#guidance");
const postSection = document.querySelector("#post");
const handle = document.querySelector("#handle");
const permalink = document.querySelector("#permalink");
const membership = document.querySelector("#membership");
const report = document.querySelector("#report");
const reportTip = document.querySelector("#report-tip");
const reporter = document.querySelector("#reporter");
const reporterError = document.querySelector("#reporter-error");
const quota = document.querySelector("#quota");
const copy = document.querySelector("#copy");
const inline = document.querySelector("#inline");
const hide = document.querySelector("#hide");
const removedTag = document.querySelector("#removed-tag");
const inlineStatus = document.querySelector("#inline-status");
const refresh = document.querySelector("#refresh");
const freshness = document.querySelector("#freshness");
const removedFreshness = document.querySelector("#removed-freshness");
const feedback = document.querySelector("#feedback");
const syncWarning = document.querySelector("#sync-warning");
const syncDetail = document.querySelector("#sync-detail");
const acceptList = document.querySelector("#accept-list");
const versionLabel = document.querySelector("#version-label");
const updateLink = document.querySelector("#update-link");
const updateRefresh = document.querySelector("#update-refresh");
const updateStatus = document.querySelector("#update-status");

const reporterErrorMessage = "Use 1–15 letters, numbers, or underscores. An @ at the start is optional.";

function showReporterError() {
  reporter.setAttribute("aria-invalid", "true");
  reporterError.textContent = reporterErrorMessage;
  reporterError.hidden = false;
}

function clearReporterError() {
  reporter.setAttribute("aria-invalid", "false");
  reporterError.textContent = "";
  reporterError.hidden = true;
}

async function saveReporter(value) {
  if (value) await chrome.storage.local.set({ [REPORTER_KEY]: value });
  else await chrome.storage.local.remove(REPORTER_KEY);
  reporter.value = value;
}

const draft = new URL(window.location.href).searchParams;
const [activeTab] = draft.has("post") ? [] : await chrome.tabs.query({ active: true, currentWindow: true });
const post = parsePostLink(draft.has("post") ? draft.get("post") : activeTab?.url);
const onX = /^https:\/\/(?:www\.)?x\.com\/|^https:\/\/(?:[^./]+\.)?twitter\.com\//i.test(activeTab?.url ?? "");

let openingReport = false;
let alreadyListed = false;
let cache;
let removedCache;
let syncIssue;
let removedSyncIssue;
let checkingUpdates = false;
let currentUpdate = null;

function showUpdate(update) {
  currentUpdate = update ?? null;
  updateLink.hidden = !update;
  if (update) {
    updateLink.href = update.url;
    updateLink.textContent = `${versionLabel.textContent} -> Version ${update.version}`;
    versionLabel.hidden = true;
  } else {
    versionLabel.hidden = false;
    updateLink.removeAttribute("href");
  }
}

function showUpdateError(message = "") {
  updateStatus.textContent = message;
  updateStatus.hidden = !message;
}

async function showQuota() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "report-quota" });
    if (!result?.ok) return;
    quota.textContent = `Reports this hour: ${result.used}/${result.limit}` +
      (result.used >= result.limit ? ` · resets in ${Math.ceil(result.resetMs / 60_000)} min` : "");
  } catch {
    quota.textContent = "";
  }
}

async function checkForUpdates(force = false) {
  if (checkingUpdates) return;

  checkingUpdates = true;
  updateRefresh.disabled = true;
  updateRefresh.setAttribute("aria-busy", "true");
  try {
    const result = await chrome.runtime.sendMessage({ type: "check-updates", force });
    if (!result?.ok) {
      const lastKnownUpdate = result?.update ?? currentUpdate;
      showUpdate(lastKnownUpdate);
      showUpdateError(lastKnownUpdate
        ? "Could not check for updates. Showing the last known download."
        : "Could not check for updates. Try again.");
      return;
    }

    showUpdate(result.update);
    showUpdateError();
  } catch (error) {
    console.warn("Could not check for extension updates.", error);
    showUpdate(currentUpdate);
    showUpdateError(currentUpdate
      ? "Could not check for updates. Showing the last known download."
      : "Could not check for updates. Try again.");
  } finally {
    checkingUpdates = false;
    updateRefresh.disabled = false;
    updateRefresh.removeAttribute("aria-busy");
  }
}

function syncLabel(timestamp) {
  const now = new Date();
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "Sync time unavailable";

  if (now - date >= 0 && now - date < 60_000) return "Synced just now";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (now.toDateString() === date.toDateString()) return `Synced today at ${time}`;
  return `Synced ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

async function showInlineStatus() {
  inlineStatus.hidden = true;
  if ((!inline.checked && !hide.checked) || !onX || !Number.isInteger(activeTab.id)) return;
  try {
    await chrome.tabs.sendMessage(activeTab.id, { type: "inline-status" });
  } catch {
    if (!inline.checked && !hide.checked) return;
    inlineStatus.textContent = "Reload X to apply these settings. If they’re still missing, check AI Spam Reporter for X’s site access.";
    inlineStatus.hidden = false;
  }
}

function showList() {
  const listed = Boolean(post && cache?.handles.includes(post.handle.toLowerCase()));
  membership.textContent = cache
    ? (listed ? "On the blocklist" : "No match in the synced list")
    : "Blocklist unavailable";
  membership.dataset.listed = String(listed);
  membership.dataset.listReady = String(Boolean(cache));
  alreadyListed = listed;
  report.hidden = listed;
  reportTip.hidden = listed;
  report.disabled = alreadyListed || openingReport;
  freshness.title = cache ? new Date(cache.updatedAt).toLocaleString() : "";
  freshness.textContent = `Blocklist: ${cache ? syncLabel(cache.updatedAt) : "not synced yet"}`;
  const removedMessage = removedSyncIssue?.type === "failed"
    ? removedCache ? `sync failed; last synced ${syncLabel(removedCache.updatedAt)}` : "sync failed"
    : removedCache ? syncLabel(removedCache.updatedAt) : "not synced yet";
  removedFreshness.textContent = `Previously blocked: ${removedMessage}`;
  removedFreshness.dataset.state = removedSyncIssue?.type === "failed" ? "failed" : "";
  removedFreshness.title = removedCache ? new Date(removedCache.updatedAt).toLocaleString() : "";
  syncWarning.hidden = !syncIssue;
  acceptList.hidden = syncIssue?.type !== "drop";
  if (syncIssue?.type === "drop") {
    syncDetail.textContent = `Using last synced list. The latest download has ${syncIssue.count.toLocaleString()} accounts, down from ${syncIssue.previousCount.toLocaleString()}. Sync again or choose Use smaller list to recheck and accept it.`;
  } else {
    syncDetail.textContent = cache ? "Sync failed. Using last synced list." : "Sync failed. Try again to download the blocklist.";
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[CACHE_KEY]) cache = changes[CACHE_KEY].newValue;
  if (changes[REMOVED_CACHE_KEY]) removedCache = changes[REMOVED_CACHE_KEY].newValue;
  if (changes[SYNC_KEY]) syncIssue = changes[SYNC_KEY].newValue;
  if (changes[REMOVED_SYNC_KEY]) removedSyncIssue = changes[REMOVED_SYNC_KEY].newValue;
  if (changes[CACHE_KEY] || changes[REMOVED_CACHE_KEY] || changes[SYNC_KEY] || changes[REMOVED_SYNC_KEY]) showList();
  if (changes[UPDATE_CACHE_KEY]) {
    const update = changes[UPDATE_CACHE_KEY].newValue?.update;
    showUpdate(update ?? null);
    showUpdateError();
  }
  if (changes[REMOVED_TAG_KEY]) removedTag.checked = changes[REMOVED_TAG_KEY].newValue !== false;
  if (changes[HIDE_KEY]) hide.checked = changes[HIDE_KEY].newValue === true;
  if (changes[INLINE_KEY]) {
    inline.checked = changes[INLINE_KEY].newValue !== false;
    showInlineStatus();
  }
});

if (post) {
  guidance.hidden = true;
  postSection.hidden = false;
  handle.textContent = `@${post.handle}`;
  permalink.href = post.url;
} else if (draft.has("post")) {
  guidance.querySelector("p").textContent = "Open the post itself, then choose Report AI Post.";
}

const installedVersion = chrome.runtime.getManifest?.().version;
versionLabel.textContent = installedVersion ? `Version ${installedVersion}` : "Version unavailable";
updateRefresh.disabled = !installedVersion;
updateRefresh.addEventListener("click", () => {
  if (installedVersion) return checkForUpdates(true);
});
if (installedVersion) checkForUpdates();

report.addEventListener("click", async () => {
  if (!post || report.disabled) return;

  const reporterValue = normalizeReporter(reporter.value);
  if (reporterValue === null) {
    showReporterError();
    reporter.focus();
    return;
  }
  clearReporterError();
  try {
    await saveReporter(reporterValue);
  } catch {
    feedback.textContent = "Could not save your username, so the report wasn't sent.";
    return;
  }

  openingReport = true;
  report.disabled = true;
  feedback.textContent = "Sending report…";
  try {
    let result = await chrome.runtime.sendMessage({ type: "submit-report", url: post.url });
    if (result?.fallback) {
      feedback.textContent = "Couldn’t send directly. Opening the report form…";
      result = await chrome.runtime.sendMessage({ type: "open-report", url: post.url });
      if (!result?.ok) throw new Error(result?.error ?? "Could not open the report form.");
      feedback.textContent = "Report tab opened. Review the form before sending.";
    } else {
      if (!result?.ok) throw new Error(result?.error ?? "Could not send the report.");
      feedback.textContent = result.message || "Reported. Thank you!";
    }
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    openingReport = false;
    report.disabled = alreadyListed;
    showQuota();
  }
});

reporter.addEventListener("input", () => {
  if (reporter.getAttribute("aria-invalid") === "true" && normalizeReporter(reporter.value) !== null) {
    clearReporterError();
  }
});

reporter.addEventListener("change", async () => {
  const value = normalizeReporter(reporter.value);
  if (value === null) {
    showReporterError();
    return;
  }
  clearReporterError();
  try {
    await saveReporter(value);
    feedback.textContent = value ? "Username saved." : "Username cleared.";
  } catch {
    feedback.textContent = "Could not save the username.";
  }
});

copy.addEventListener("click", async () => {
  if (!post) return;
  try {
    await navigator.clipboard.writeText(post.url);
    feedback.textContent = "Link copied.";
  } catch {
    feedback.textContent = "Couldn’t copy the link. Right-click View post and copy its link.";
  }
});

inline.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({ [INLINE_KEY]: inline.checked });
    showInlineStatus();
  } catch {
    inline.checked = !inline.checked;
    feedback.textContent = "Could not save the setting.";
  }
});

hide.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({ [HIDE_KEY]: hide.checked });
    showInlineStatus();
  } catch {
    hide.checked = !hide.checked;
    feedback.textContent = "Could not save the setting.";
  }
});

removedTag.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({ [REMOVED_TAG_KEY]: removedTag.checked });
  } catch {
    removedTag.checked = !removedTag.checked;
    feedback.textContent = "Could not save the setting.";
  }
});

async function requestRefresh(digest) {
  refresh.disabled = true;
  acceptList.disabled = true;
  feedback.textContent = "Syncing both lists…";
  try {
    const result = await chrome.runtime.sendMessage(digest
      ? { type: "accept-list-drop", digest }
      : { type: "refresh-list" });
    if (!result?.ok && !result?.reason) throw new Error("Refresh failed.");
    if (result.reason === "drop") {
      feedback.textContent = "";
    } else if (result.ok && result.removedOk) {
      feedback.textContent = "Both lists synced.";
    } else if (result.ok) {
      feedback.textContent = "Blocklist synced; previously blocked list sync failed.";
    } else if (result.removedOk) {
      feedback.textContent = "Blocklist sync failed; previously blocked list synced.";
    } else {
      feedback.textContent = "Both lists failed to sync.";
    }
  } catch {
    feedback.textContent = "Sync failed. Try again in a moment.";
  } finally {
    refresh.disabled = false;
    acceptList.disabled = false;
  }
}

refresh.addEventListener("click", () => requestRefresh());
acceptList.addEventListener("click", () => {
  if (syncIssue?.type === "drop") requestRefresh(syncIssue.digest);
});
const stored = await chrome.storage.local.get([
  CACHE_KEY, HIDE_KEY, INLINE_KEY, REMOVED_CACHE_KEY, REMOVED_SYNC_KEY, REMOVED_TAG_KEY, REPORTER_KEY, SYNC_KEY
]);
reporter.value = stored[REPORTER_KEY] ?? "";
removedTag.checked = stored[REMOVED_TAG_KEY] !== false;
inline.checked = stored[INLINE_KEY] !== false;
hide.checked = stored[HIDE_KEY] === true;
cache = stored[CACHE_KEY];
removedCache = stored[REMOVED_CACHE_KEY];
removedSyncIssue = stored[REMOVED_SYNC_KEY];
syncIssue = stored[SYNC_KEY];
showList();
showInlineStatus();
if (!cache) requestRefresh();
showQuota();
