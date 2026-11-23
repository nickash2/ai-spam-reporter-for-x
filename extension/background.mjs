import {
  CACHE_KEY, FEED_URL, RELEASES_API_URL, REMOVED_CACHE_KEY, REMOVED_FEED_URL, REMOVED_SYNC_KEY, REPORT_URL, SYNC_KEY,
  UPDATE_CACHE_KEY, UPDATE_CHECK_INTERVAL_MS, findNewerRelease, parsePostLink, parseRemovedFeed, parseUsernameFeed
} from "./reply.mjs";

const refreshAlarm = "refresh-reviewed-list";
const reportMenu = "review-reply-link";
const refreshPeriodMinutes = 60;
let pendingRefresh;
let pendingUpdateCheck;

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
          return { ok: false, reason: "drop", removedOk: await removedRefresh };
        }
      }

      const now = Date.now();
      await chrome.storage.local.set({ [CACHE_KEY]: { handles, updatedAt: now }, [SYNC_KEY]: null });
      return { ok: true, removedOk: await removedRefresh };
    } catch {
      const removedOk = await removedRefresh;
      await chrome.storage.local.set({ [SYNC_KEY]: { type: "failed" } });
      return { ok: false, reason: "failed", removedOk };
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

    const accounts = parseRemovedFeed(await response.text());
    const handles = accounts.map(account => account.username);
    const removedAt = Object.fromEntries(accounts.map(account => [account.username, account.removed]));
    await chrome.storage.local.set({
      [REMOVED_CACHE_KEY]: { handles, removedAt, updatedAt: Date.now() },
      [REMOVED_SYNC_KEY]: null
    });
    return true;
  } catch (error) {
    console.warn("Could not refresh the removed-account list.", error);
    try {
      await chrome.storage.local.set({ [REMOVED_SYNC_KEY]: { type: "failed", attemptedAt: Date.now() } });
    } catch (storageError) {
      console.warn("Could not save removed-account sync status.", storageError);
    }
    return false;
  }
}

function validUpdateCache(value, installedVersion) {
  if (value?.installedVersion !== installedVersion || !Number.isFinite(value.checkedAt) ||
      value.checkedAt > Date.now() || !("update" in value)) return false;
  if (value.update === null) return true;
  if (typeof value.update?.version !== "string" || typeof value.update.url !== "string") return false;
  try {
    const url = new URL(value.update.url);
    return url.origin === "https://github.com" &&
      url.pathname.startsWith("/nickash2/ai-spam-reporter-for-x/releases/download/");
  } catch {
    return false;
  }
}

function checkForUpdates(force = false) {
  if (pendingUpdateCheck) return pendingUpdateCheck;

  pendingUpdateCheck = (async () => {
    const installedVersion = chrome.runtime.getManifest().version;
    let stored;
    try {
      stored = await chrome.storage.local.get(UPDATE_CACHE_KEY);
    } catch (error) {
      console.warn("Could not read cached release information.", error);
    }

    const cached = stored?.[UPDATE_CACHE_KEY];
    const cacheValid = validUpdateCache(cached, installedVersion);
    if (cacheValid && !force && Date.now() - cached.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
      return { ok: true, update: cached.update };
    }

    try {
      const response = await fetch(RELEASES_API_URL, {
        cache: "no-cache",
        credentials: "omit",
        headers: { Accept: "application/vnd.github+json" },
        redirect: "error",
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) throw new Error(`GitHub update check failed (HTTP ${response.status}).`);

      const update = findNewerRelease(await response.json(), installedVersion);
      try {
        await chrome.storage.local.set({
          [UPDATE_CACHE_KEY]: { checkedAt: Date.now(), installedVersion, update }
        });
      } catch (error) {
        console.warn("Could not cache GitHub release information.", error);
      }
      return { ok: true, update };
    } catch (error) {
      console.warn("Could not check for extension updates.", error);
      return { ok: false, update: cacheValid ? cached.update : null };
    }
  })().finally(() => {
    pendingUpdateCheck = undefined;
  });

  return pendingUpdateCheck;
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
  checkForUpdates(true).catch(console.warn);
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== reportMenu) return;
  const post = parsePostLink(info.linkUrl);
  const reviewUrl = new URL(chrome.runtime.getURL("review.html"));
  reviewUrl.searchParams.set("post", post?.url ?? "");
  chrome.tabs.create({ url: reviewUrl.href }).catch(console.warn);
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== refreshAlarm) return;
  await Promise.all([
    refreshList().catch(console.warn),
    checkForUpdates(true).catch(console.warn)
  ]);
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get([CACHE_KEY, REMOVED_CACHE_KEY, REMOVED_SYNC_KEY]);
  const now = Date.now();
  const age = now - (stored[CACHE_KEY]?.updatedAt ?? 0);
  const removedAge = now - (stored[REMOVED_CACHE_KEY]?.updatedAt ?? 0);
  const needsRefresh = age >= refreshPeriodMinutes * 60_000 ||
    removedAge >= refreshPeriodMinutes * 60_000 || stored[REMOVED_SYNC_KEY]?.type === "failed";
  await Promise.all([
    needsRefresh ? refreshList().catch(console.warn) : Promise.resolve(),
    checkForUpdates().catch(console.warn)
  ]);
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;

  let operation;
  if (message?.type === "refresh-list") {
    operation = refreshList();
  } else if (message?.type === "check-updates") {
    operation = checkForUpdates(message.force === true);
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
    return { ok: false, error: "This account is already on the blocklist." };
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
