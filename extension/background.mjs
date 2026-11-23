import {
  CACHE_KEY, FEED_URL, REMOVED_CACHE_KEY, REMOVED_FEED_URL, REPORT_URL, SYNC_KEY,
  parsePostLink, parseRemovedFeed, parseUsernameFeed
} from "./reply.mjs";

const refreshAlarm = "refresh-reviewed-list";
const reportMenu = "review-reply-link";
const refreshPeriodMinutes = 60;
let pendingRefresh;

function refreshList(approvedDigest) {
  if (pendingRefresh) return pendingRefresh;

  pendingRefresh = (async () => {
    const removedRefresh = refreshRemovedAccounts();
    try {
      const response = await fetch(FEED_URL, {
        cache: "no-cache",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(12_000)
      });
      if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);

      const handles = parseUsernameFeed(await response.text());
      const stored = await chrome.storage.local.get([CACHE_KEY, SYNC_KEY]);
      const previousCount = stored[CACHE_KEY]?.handles.length ?? 0;
      if (previousCount >= 100 && handles.length < previousCount * .75) {
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(handles.join("\n")));
        const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
        if (approvedDigest !== digest || stored[SYNC_KEY]?.digest !== digest) {
          await chrome.storage.local.set({
            [SYNC_KEY]: { type: "drop", previousCount, count: handles.length, digest }
          });
          await removedRefresh;
          return { ok: false, reason: "drop" };
        }
      }

      const now = Date.now();
      await chrome.storage.local.set({ [CACHE_KEY]: { handles, updatedAt: now }, [SYNC_KEY]: null });
      await removedRefresh;
      return { ok: true };
    } catch {
      await removedRefresh;
      await chrome.storage.local.set({ [SYNC_KEY]: { type: "failed" } });
      return { ok: false, reason: "failed" };
    }
  })().finally(() => {
    pendingRefresh = undefined;
  });

  return pendingRefresh;
}

async function refreshRemovedAccounts() {
  try {
    const response = await fetch(REMOVED_FEED_URL, {
      cache: "no-cache",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);

    const handles = parseRemovedFeed(await response.text());
    await chrome.storage.local.set({ [REMOVED_CACHE_KEY]: { handles, updatedAt: Date.now() } });
  } catch (error) {
    console.warn("Could not refresh the removed-account list.", error);
  }
}

async function prepareSchedule() {
  if (!await chrome.alarms.get(refreshAlarm)) {
    await chrome.alarms.create(refreshAlarm, { periodInMinutes: refreshPeriodMinutes });
  }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install" || reason === "update") {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: reportMenu,
        title: "Report AI Post",
        contexts: ["link"],
        targetUrlPatterns: [
          "https://x.com/*/status/*",
          "https://www.x.com/*/status/*",
          "https://*.twitter.com/*/status/*"
        ]
      });
    });
  }
  refreshList().catch(console.warn);
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== reportMenu) return;
  const post = parsePostLink(info.linkUrl);
  const reviewUrl = new URL(chrome.runtime.getURL("review.html"));
  reviewUrl.searchParams.set("post", post?.url ?? "");
  chrome.tabs.create({ url: reviewUrl.href }).catch(console.warn);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === refreshAlarm) refreshList().catch(console.warn);
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const age = Date.now() - (stored[CACHE_KEY]?.updatedAt ?? 0);
  if (age >= refreshPeriodMinutes * 60_000) refreshList().catch(console.warn);
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;

  let operation;
  if (message?.type === "refresh-list") {
    operation = refreshList();
  } else if (message?.type === "accept-list-drop" && typeof message.digest === "string" &&
             sender.url === chrome.runtime.getURL("review.html")) {
    operation = refreshList(message.digest);
  } else if (message?.type === "open-report") {
    operation = openReport(message.url);
  } else if (message?.type === "report-draft" && sender.url === REPORT_URL && Number.isInteger(sender.tab?.id)) {
    operation = getDraft(sender.tab.id);
  } else {
    return false;
  }

  operation.then(respond, () => respond({ ok: false, error: "The extension could not complete this action. Try again." }));
  return true;
});

prepareSchedule().catch(console.warn);

const draftKey = tabId => `reportDraft:${tabId}`;

async function openReport(value) {
  const post = parsePostLink(value);
  if (!post) return { ok: false, error: "Choose the URL of an X post." };

  const stored = await chrome.storage.local.get(CACHE_KEY);
  if (stored[CACHE_KEY]?.handles.includes(post.handle.toLowerCase())) {
    return { ok: false, error: "This account is already on the reviewed list." };
  }

  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  const key = draftKey(tab.id);
  try {
    await chrome.storage.session.set({ [key]: post.url });
    await chrome.tabs.update(tab.id, { url: REPORT_URL, active: true });
    return { ok: true };
  } catch (error) {
    await Promise.allSettled([chrome.storage.session.remove(key), chrome.tabs.remove(tab.id)]);
    throw error;
  }
}

async function getDraft(tabId) {
  const key = draftKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] ? { ok: true, url: stored[key] } : { ok: true };
}

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(draftKey(tabId)).catch(console.warn);
});
