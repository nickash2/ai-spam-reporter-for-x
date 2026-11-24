import {
  CACHE_KEY, FEED_URL, REMOVED_CACHE_KEY, REMOVED_FEED_URL, REMOVED_SYNC_KEY, REPORTER_KEY, REPORT_API_URL, REPORT_HISTORY_KEY, REPORT_LIMIT, REPORT_URL, SYNC_KEY,
  parsePostLink, parseRemovedFeed, parseUsernameFeed, reportQuota
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

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== refreshAlarm) return;
  refreshList().catch(console.warn);
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get([CACHE_KEY, REMOVED_CACHE_KEY, REMOVED_SYNC_KEY]);
  const now = Date.now();
  const age = now - (stored[CACHE_KEY]?.updatedAt ?? 0);
  const removedAge = now - (stored[REMOVED_CACHE_KEY]?.updatedAt ?? 0);
  const needsRefresh = age >= refreshPeriodMinutes * 60_000 ||
    removedAge >= refreshPeriodMinutes * 60_000 || stored[REMOVED_SYNC_KEY]?.type === "failed";
  if (needsRefresh) await refreshList().catch(console.warn);
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
  } else if (message?.type === "report-quota") {
    operation = chrome.storage.local.get(REPORT_HISTORY_KEY).then(stored => {
      const { used, limit, resetMs } = reportQuota(stored[REPORT_HISTORY_KEY]);
      return { ok: true, used, limit, resetMs };
    });
  } else if (message?.type === "submit-report") {
    operation = submitReport(message.url);
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

  const stored = await chrome.storage.local.get([CACHE_KEY, REPORTER_KEY]);
  if (stored[CACHE_KEY]?.handles.includes(post.handle.toLowerCase())) {
    return { ok: false, error: "This account is already on the blocklist." };
  }

  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  const key = draftKey(tab.id);
  try {
    await chrome.storage.session.set({
      [key]: { url: post.url, reporter: stored[REPORTER_KEY] ?? "" }
    });
    await chrome.tabs.update(tab.id, { url: REPORT_URL, active: true });
    return { ok: true };
  } catch (error) {
    await Promise.allSettled([chrome.storage.session.remove(key), chrome.tabs.remove(tab.id)]);
    throw error;
  }
}

async function submitReport(value) {
  const post = parsePostLink(value);
  if (!post) return { ok: false, error: "Choose the URL of an X post." };

  const stored = await chrome.storage.local.get([CACHE_KEY, REPORTER_KEY, REPORT_HISTORY_KEY]);
  if (stored[CACHE_KEY]?.handles.includes(post.handle.toLowerCase())) {
    return { ok: false, error: "This account is already on the blocklist." };
  }

  const quota = reportQuota(stored[REPORT_HISTORY_KEY]);
  if (quota.used >= quota.limit) {
    return { ok: false, error: `Hourly report limit reached. Try again in ${Math.ceil(quota.resetMs / 60_000)} min.` };
  }
  if (quota.cooldownMs > 0) {
    return { ok: false, error: `Please wait ${Math.ceil(quota.cooldownMs / 1000)}s before the next report.` };
  }

  const payload = { tweet_url: post.url };
  if (stored[REPORTER_KEY]) payload.reporter = stored[REPORTER_KEY];

  let response;
  try {
    response = await fetch(REPORT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit"
    });
  } catch {
    return { ok: false, fallback: true, error: "Couldn’t reach the report service." };
  }

  const body = await response.json().catch(() => null);
  if (response.ok && body?.ok) {
    await chrome.storage.local.set({ [REPORT_HISTORY_KEY]: [...quota.recent, Date.now()] });
    return { ok: true, message: body.message };
  }
  if (response.status === 429) {
    // The server's limit is per IP, so fill our local window to match.
    const filled = Array.from({ length: Math.max(0, REPORT_LIMIT - quota.used) }, () => Date.now());
    await chrome.storage.local.set({ [REPORT_HISTORY_KEY]: [...quota.recent, ...filled] });
    const seconds = Number(body?.retry_after ?? response.headers.get("Retry-After"));
    const wait = Number.isFinite(seconds) && seconds > 0 ? ` Try again in ${Math.ceil(seconds / 60)} min.` : "";
    return { ok: false, error: `Report limit reached.${wait}` };
  }
  const error = typeof body?.error === "string" ? body.error : "The report was not accepted.";
  return {
    ok: false,
    fallback: response.status === 401 || response.status === 403 || response.status >= 500 ||
      /human check|human verification|captcha/i.test(error),
    error
  };
}

async function getDraft(tabId) {
  const key = draftKey(tabId);
  const [session, local] = await Promise.all([
    chrome.storage.session.get(key),
    chrome.storage.local.get(REPORTER_KEY)
  ]);
  const draft = session[key];
  if (typeof draft === "string") {
    return { ok: true, url: draft, reporter: local[REPORTER_KEY] ?? "" };
  }
  return typeof draft?.url === "string"
    ? {
      ok: true,
      url: draft.url,
      reporter: typeof draft.reporter === "string" && draft.reporter ? draft.reporter : local[REPORTER_KEY] ?? ""
    }
    : { ok: true };
}

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(draftKey(tabId)).catch(console.warn);
});
