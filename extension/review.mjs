import {
  CACHE_KEY, HIDE_KEY, INLINE_KEY, REMOVED_TAG_KEY, SYNC_KEY, UPDATE_CACHE_KEY, parsePostLink
} from "./reply.mjs";

const guidance = document.querySelector("#guidance");
const postSection = document.querySelector("#post");
const handle = document.querySelector("#handle");
const permalink = document.querySelector("#permalink");
const membership = document.querySelector("#membership");
const report = document.querySelector("#report");
const reportTip = document.querySelector("#report-tip");
const copy = document.querySelector("#copy");
const inline = document.querySelector("#inline");
const hide = document.querySelector("#hide");
const removedTag = document.querySelector("#removed-tag");
const inlineStatus = document.querySelector("#inline-status");
const refresh = document.querySelector("#refresh");
const freshness = document.querySelector("#freshness");
const feedback = document.querySelector("#feedback");
const syncWarning = document.querySelector("#sync-warning");
const syncDetail = document.querySelector("#sync-detail");
const acceptList = document.querySelector("#accept-list");
const versionLabel = document.querySelector("#version-label");
const updateStatus = document.querySelector("#update-status");
const updateLink = document.querySelector("#update-link");
const updateRefresh = document.querySelector("#update-refresh");

const draft = new URL(window.location.href).searchParams;
const [activeTab] = draft.has("post") ? [] : await chrome.tabs.query({ active: true, currentWindow: true });
const post = parsePostLink(draft.has("post") ? draft.get("post") : activeTab?.url);
const onX = /^https:\/\/(?:www\.)?x\.com\/|^https:\/\/(?:[^./]+\.)?twitter\.com\//i.test(activeTab?.url ?? "");

let openingReport = false;
let alreadyListed = false;
let cache;
let syncIssue;
let checkingUpdates = false;

function showUpdate(update, message) {
  updateLink.hidden = !update;
  if (update) {
    updateLink.href = update.url;
    updateLink.textContent = `Download v${update.version}`;
  } else {
    updateLink.removeAttribute("href");
  }
  updateStatus.textContent = message;
  updateStatus.hidden = false;
}

async function checkForUpdates(force = false) {
  if (checkingUpdates) return;

  checkingUpdates = true;
  updateRefresh.disabled = true;
  updateRefresh.setAttribute("aria-busy", "true");
  try {
    updateStatus.textContent = "Checking for updates…";
    updateStatus.hidden = false;
    const result = await chrome.runtime.sendMessage({ type: "check-updates", force });
    if (!result?.ok) {
      showUpdate(result?.update ?? null,
        result?.update ? "Update check unavailable; showing the last check." : "Could not check for updates.");
      return;
    }

    showUpdate(result.update, result.update ? "A newer version is available." : "You're up to date.");
  } catch (error) {
    console.warn("Could not check for extension updates.", error);
    showUpdate(null, "Could not check for updates.");
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

  freshness.title = date.toLocaleString();
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
  freshness.title = "";
  freshness.textContent = cache ? syncLabel(cache.updatedAt) : "Sync needed";
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
  if (changes[SYNC_KEY]) syncIssue = changes[SYNC_KEY].newValue;
  if (changes[CACHE_KEY] || changes[SYNC_KEY]) showList();
  if (changes[UPDATE_CACHE_KEY]) {
    const update = changes[UPDATE_CACHE_KEY].newValue?.update;
    showUpdate(update ?? null, update ? "A newer version is available." : "You're up to date.");
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

  openingReport = true;
  report.disabled = true;
  feedback.textContent = "Opening the report form…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "open-report", url: post.url });
    if (!result?.ok) throw new Error(result?.error ?? "Could not open the report form.");
    feedback.textContent = "Report tab opened. Review the form before sending.";
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    openingReport = false;
    report.disabled = alreadyListed;
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
  feedback.textContent = "Syncing the blocklist…";
  try {
    const result = await chrome.runtime.sendMessage(digest
      ? { type: "accept-list-drop", digest }
      : { type: "refresh-list" });
    if (!result?.ok && !result?.reason) throw new Error("Refresh failed.");
    feedback.textContent = result.ok ? "Blocklist synced." : "";
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
const stored = await chrome.storage.local.get([CACHE_KEY, HIDE_KEY, INLINE_KEY, REMOVED_TAG_KEY, SYNC_KEY]);
removedTag.checked = stored[REMOVED_TAG_KEY] !== false;
inline.checked = stored[INLINE_KEY] !== false;
hide.checked = stored[HIDE_KEY] === true;
cache = stored[CACHE_KEY];
syncIssue = stored[SYNC_KEY];
showList();
showInlineStatus();
if (!cache) requestRefresh();
