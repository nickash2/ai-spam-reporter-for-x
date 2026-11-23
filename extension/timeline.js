(() => {
  const { parsePostLink, handlePattern } = globalThis.replyReportLinks;
  const removedCacheKey = "removedAccounts";
  const cardSelector = 'article[data-testid="tweet"]';
  const headerSelector = '[data-testid="User-Name"]';
  // X marks regular username and timestamp anchors with role="link" too.
  const quoteSelector = '[data-testid="quoteTweet"], [role="link"]:not(a)';
  const controls = new WeakMap();
  const dirtyCards = new Set();
  const narrowLayout = window.matchMedia("(max-width: 640px)");
  let reviewed = new Set();
  let removed = new Map();
  let enabled = true;
  let hideBlocked = false;
  let showRemoved = true;
  let frame = 0;

  function belongsToPost(element, card) {
    const quote = element.closest(quoteSelector);
    return element.closest(cardSelector) === card && (!quote || !card.contains(quote) || quote === card);
  }

  function selectPost(card) {
    const header = [...card.querySelectorAll(headerSelector)].find(element => belongsToPost(element, card));
    if (!header) return null;

    const candidates = [...header.querySelectorAll("a[href]")].filter(link => belongsToPost(link, card));
    const pagePost = parsePostLink(location.href);
    const timestamp = candidates.find(link => link.querySelector("time")) ??
      (pagePost && [...card.querySelectorAll("a[href]")].find(link =>
        belongsToPost(link, card) && link.querySelector("time") &&
        parsePostLink(link.href)?.url === pagePost.url));
    const post = parsePostLink(timestamp?.href);
    const isOpenPost = Boolean(post && pagePost && post.url.toLowerCase() === pagePost.url.toLowerCase());
    const profileLinks = candidates.filter(link => link.origin === location.origin);
    if (post && profileLinks.some(link => link.pathname.toLowerCase() === `/${post.handle.toLowerCase()}`)) {
      return { post, handle: post.handle, header, timestamp, isOpenPost, showBadgesBelow: isOpenPost };
    }

    const usernameLink = profileLinks.find(link => {
      const username = link.pathname.slice(1);
      return handlePattern.test(username) && link.textContent.trim().toLowerCase() === `@${username.toLowerCase()}`;
    });
    return usernameLink ? { handle: usernameLink.pathname.slice(1), header, showBadgesBelow: true } : null;
  }

  function findActionRow(card) {
    return [...card.querySelectorAll('[role="group"]')].find(group =>
      belongsToPost(group, card) &&
      [...group.querySelectorAll('[data-testid="reply"], [data-testid="like"], [data-testid="unlike"]')]
        .some(action => belongsToPost(action, card) && action.closest('[role="group"]') === group)
    );
  }

  function createControl(card) {
    const wrapper = document.createElement("span");
    wrapper.className = "rrx-inline";
    const badgeWrapper = document.createElement("span");
    badgeWrapper.className = "rrx-inline rrx-listed";
    const button = document.createElement("button");
    button.type = "button";
    const label = document.createElement("span");
    label.className = "rrx-tag rrx-tag-status";
    const text = document.createElement("span");
    const source = document.createElement("strong");
    source.textContent = "blockedforaireply.com";
    text.append("Blocked on ", source);
    label.append(text);
    const error = document.createElement("span");
    error.setAttribute("role", "status");
    error.className = "rrx-error";
    error.hidden = true;
    wrapper.append(button, error);
    badgeWrapper.append(label);

    const control = { wrapper, badgeWrapper, button, label, text, source, error, opening: false, url: "" };
    wrapper.addEventListener("pointerdown", event => event.stopPropagation());
    wrapper.addEventListener("click", event => event.stopPropagation());
    button.addEventListener("click", async event => {
      event.preventDefault();
      if (!event.isTrusted || !enabled || control.opening) return;

      const selected = selectPost(card);
      if (!selected?.post || selected.post.url !== control.url || reviewed.has(selected.handle.toLowerCase())) {
        queue(card);
        return;
      }

      control.opening = true;
      button.disabled = true;
      error.hidden = true;
      try {
        const response = await chrome.runtime.sendMessage({ type: "open-report", url: selected.post.url });
        if (!response?.ok) throw new Error(response?.error ?? "Could not open the report form.");
      } catch (failure) {
        if (control.url === selected.post.url) {
          error.textContent = failure.message;
          error.hidden = false;
        }
      } finally {
        control.opening = false;
        button.disabled = false;
      }
    });

    return control;
  }

  function updateCard(card) {
    let control = controls.get(card);
    const selection = (enabled || hideBlocked) && card.isConnected ? selectPost(card) : null;
    const key = selection?.handle.toLowerCase();
    const blocked = Boolean(selection && reviewed.has(key));
    const hidden = hideBlocked && blocked && !selection.isOpenPost;
    card.toggleAttribute("data-rrx-hidden", hidden);
    const former = Boolean(selection && showRemoved && !blocked && removed.has(key));
    const tagged = blocked || former;
    if (!enabled || hidden || (!selection?.post && !tagged)) {
      control?.wrapper.remove();
      controls.delete(card);
      return;
    }

    const { post, handle, header, timestamp, showBadgesBelow } = selection;
    if (!control) {
      control = createControl(card);
      controls.set(card, control);
    }
    const url = post?.url ?? "";
    if (control.url !== url || control.handle !== handle) {
      control.url = url;
      control.handle = handle;
      control.error.hidden = true;
      control.button.setAttribute("aria-label", `Report AI Post by @${handle} to Blocked for AI Reply`);
    }
    const removedDate = removed.get(key);
    const formattedRemovedDate = removedDate
      ? new Date(`${removedDate}T00:00:00`).toLocaleDateString(undefined, {
        month: "short", day: "numeric", year: "numeric"
      })
      : null;
    const removedLabel = `Previously blocked${formattedRemovedDate ? ` · Removed ${formattedRemovedDate}` : ""}`;
    control.label.title = former
      ? `@${handle} was removed from the list${formattedRemovedDate ? ` on ${formattedRemovedDate}` : ""}`
      : `@${handle} is on the blocklist`;
    control.text.replaceChildren(...(former ? [removedLabel] : ["Blocked on ", control.source]));
    control.label.classList.toggle("rrx-tag-removed", former);

    control.button.hidden = blocked || !post;
    const buttonText = narrowLayout.matches ? "Report" : "Report AI Post";
    if (control.button.textContent !== buttonText) control.button.textContent = buttonText;
    control.label.hidden = !tagged;
    control.badgeWrapper.hidden = !tagged;
    const badgeBelow = tagged && (showBadgesBelow || narrowLayout.matches);
    control.badgeWrapper.classList.toggle("rrx-under-author", Boolean(badgeBelow));
    if (blocked) control.error.hidden = true;

    const actionRow = blocked ? null : findActionRow(card);
    control.wrapper.classList.toggle("rrx-in-action-row", Boolean(actionRow));
    if (!tagged) {
      control.badgeWrapper.remove();
    } else if (badgeBelow) {
      if (control.badgeWrapper.parentElement !== header) header.append(control.badgeWrapper);
    } else {
      const anchor = timestamp && header.contains(timestamp) ? timestamp : header;
      if (anchor.nextElementSibling !== control.badgeWrapper) anchor.after(control.badgeWrapper);
    }

    if (badgeBelow) {
      if (actionRow) {
        if (control.wrapper.parentElement !== actionRow) actionRow.append(control.wrapper);
      } else {
        const anchor = control.badgeWrapper.parentElement === header
          ? control.badgeWrapper
          : timestamp && header.contains(timestamp) ? timestamp : header;
        if (anchor.nextElementSibling !== control.wrapper) anchor.after(control.wrapper);
      }
    } else if (actionRow) {
      if (control.wrapper.parentElement !== actionRow) actionRow.append(control.wrapper);
    } else {
      const anchor = tagged && control.badgeWrapper.parentElement === header
        ? control.badgeWrapper
        : timestamp && header.contains(timestamp) ? timestamp : header;
      if (anchor.nextElementSibling !== control.wrapper) anchor.after(control.wrapper);
    }
  }

  function queue(card) {
    if (!card) return;
    dirtyCards.add(card);
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        for (const changed of dirtyCards) updateCard(changed);
        dirtyCards.clear();
      });
    }
  }

  function queueAll() {
    for (const card of document.querySelectorAll(cardSelector)) queue(card);
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "inline-status") return;
    respond({
      cards: document.querySelectorAll(cardSelector).length,
      controls: document.querySelectorAll(".rrx-inline").length
    });
  });

  chrome.storage.local.get(["reviewedList", removedCacheKey, "showInlineControls", "hideBlockedAccounts", "showPreviouslyBlocked"]).then(values => {
    reviewed = new Set(values.reviewedList?.handles ?? []);
    removed = new Map((values[removedCacheKey]?.handles ?? []).map(handle => [
      handle,
      values[removedCacheKey]?.removedAt?.[handle]
    ]));
    enabled = values.showInlineControls !== false;
    hideBlocked = values.hideBlockedAccounts === true;
    showRemoved = values.showPreviouslyBlocked !== false;
    queueAll();
    narrowLayout.addEventListener("change", queueAll);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.reviewedList) {
        reviewed = new Set(changes.reviewedList.newValue?.handles ?? []);
      }
      if (changes[removedCacheKey]) {
        const cache = changes[removedCacheKey].newValue;
        removed = new Map((cache?.handles ?? []).map(handle => [handle, cache?.removedAt?.[handle]]));
      }
      if (changes.showPreviouslyBlocked) showRemoved = changes.showPreviouslyBlocked.newValue !== false;
      if (changes.hideBlockedAccounts) hideBlocked = changes.hideBlockedAccounts.newValue === true;
      if (changes.showInlineControls) enabled = changes.showInlineControls.newValue !== false;
      if (changes.reviewedList || changes[removedCacheKey] || changes.showInlineControls || changes.hideBlockedAccounts || changes.showPreviouslyBlocked) queueAll();
    });

    new MutationObserver(records => {
      if (!enabled && !hideBlocked) return;
      for (const change of records) {
        if (change.target.closest(".rrx-inline")) continue;
        if (change.type === "childList" && !change.removedNodes.length &&
            [...change.addedNodes].every(node => node.nodeType === Node.ELEMENT_NODE && node.matches(".rrx-inline"))) continue;
        queue(change.target.closest(cardSelector));
        if (change.target.matches(".rrx-inline")) continue;
        for (const node of change.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE || node.matches(".rrx-inline")) continue;
          if (node.matches(cardSelector)) queue(node);
          for (const card of node.querySelectorAll(cardSelector)) queue(card);
        }
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "data-testid", "role"]
    });
  }).catch(console.warn);
})();
