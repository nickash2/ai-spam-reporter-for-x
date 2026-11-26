(() => {
  const { parsePostLink, handlePattern } = globalThis.replyReportLinks;
  const removedCacheKey = "removedAccounts";
  const cardSelector = 'article[data-testid="tweet"], article:not([data-testid])';
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
    if (card.parentElement?.closest("article")) return null;
    const header = [...card.querySelectorAll(headerSelector)].find(element => belongsToPost(element, card));
    if (!header) return selectPostWithoutTestIds(card);

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
      return { post, handle: post.handle, header, timestamp, isOpenPost };
    }

    const usernameLink = profileLinks.find(link => {
      const username = link.pathname.slice(1);
      return handlePattern.test(username) && link.textContent.trim().toLowerCase() === `@${username.toLowerCase()}`;
    });
    return usernameLink ? { handle: usernameLink.pathname.slice(1), header } : null;
  }

  function selectPostWithoutTestIds(card) {
    const pagePost = parsePostLink(location.href);
    const outerLink = card.parentElement?.matches('[role="link"]')
      ? [...card.parentElement.children].find(element => element.matches("a[href]"))
      : null;
    const links = [...card.querySelectorAll("a[href]")].filter(link => belongsToPost(link, card));
    const post = parsePostLink(outerLink?.href) ?? (pagePost && links.some(link =>
      parsePostLink(link.href)?.url.toLowerCase() === pagePost.url.toLowerCase()
    ) ? pagePost : null);
    if (!post) return null;

    const usernameLink = links.find(link => {
      const username = link.pathname.slice(1);
      return link.origin === location.origin && handlePattern.test(username) &&
        link.textContent.trim().toLowerCase() === `@${username.toLowerCase()}`;
    });
    if (!usernameLink || usernameLink.pathname.slice(1).toLowerCase() !== post.handle.toLowerCase()) return null;

    return {
      post,
      handle: post.handle,
      header: usernameLink.parentElement,
      isOpenPost: Boolean(pagePost && post.url.toLowerCase() === pagePost.url.toLowerCase())
    };
  }

  function findActionRow(card) {
    return [...card.querySelectorAll('[role="group"]')].find(group =>
      belongsToPost(group, card) &&
      [...group.querySelectorAll('[data-testid="reply"], [data-testid="like"], [data-testid="unlike"], a[href^="/compose/post?in_reply_to="]')]
        .some(action => belongsToPost(action, card) && action.closest('[role="group"]') === group)
    );
  }

  function findBadgeAnchor(header, card) {
    let anchor = header;
    while (anchor.parentElement && anchor.parentElement !== card) {
      const style = window.getComputedStyle(anchor.parentElement);
      if (style.display === "block" || (style.display === "flex" && style.flexDirection.startsWith("column"))) break;
      anchor = anchor.parentElement;
    }
    return anchor;
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
        let response = await chrome.runtime.sendMessage({ type: "submit-report", url: selected.post.url });
        if (response?.fallback) response = await chrome.runtime.sendMessage({ type: "open-report", url: selected.post.url });
        else if (response?.ok && control.url === selected.post.url) {
          error.textContent = "Reported. Thank you!";
          error.hidden = false;
        }
        if (!response?.ok) throw new Error(response?.error ?? "Could not send the report.");
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

  function isTopLevelCard(card) {
    return !card.parentElement?.closest("article");
  }

  function updateContainer(container, attribute) {
    if (!container) return;
    const cards = [...container.querySelectorAll(cardSelector)].filter(isTopLevelCard);
    container.toggleAttribute(attribute, cards.length > 0 && cards.every(item => item.hasAttribute("data-rrx-hidden")));
  }

  function updateCard(card) {
    let control = controls.get(card);
    const selection = (enabled || hideBlocked) && card.isConnected ? selectPost(card) : null;
    const key = selection?.handle.toLowerCase();
    const blocked = Boolean(selection && reviewed.has(key));
    const hidden = hideBlocked && blocked && !selection.isOpenPost;
    card.toggleAttribute("data-rrx-hidden", hidden);
    if (isTopLevelCard(card)) {
      updateContainer(card.closest('[data-testid="cellInnerDiv"]'), "data-rrx-hidden");
      updateContainer(card.closest("li[data-index]"), "data-rrx-collapsed");
    }
    const former = Boolean(selection && showRemoved && !blocked && removed.has(key));
    const tagged = blocked || former;
    if (!enabled || hidden || (!selection?.post && !tagged)) {
      control?.wrapper.remove();
      control?.badgeWrapper.remove();
      controls.delete(card);
      return;
    }

    const { post, handle, header, timestamp } = selection;
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
    control.label.title = former
      ? "Previously blocked on blockedforaireply.com"
      : "Blocked on blockedforaireply.com";
    control.text.replaceChildren(...(former ? ["Previously blocked"] : narrowLayout.matches ? ["Blocked"] : ["Blocked on ", control.source]));
    control.label.classList.toggle("rrx-tag-removed", former);

    control.button.hidden = blocked || !post;
    const buttonText = narrowLayout.matches ? "Report" : "Report AI Post";
    if (control.button.textContent !== buttonText) control.button.textContent = buttonText;
    control.label.hidden = !tagged;
    control.badgeWrapper.hidden = !tagged;
    control.badgeWrapper.classList.toggle("rrx-under-author", tagged);
    if (blocked) control.error.hidden = true;

    const actionRow = blocked ? null : findActionRow(card);
    control.wrapper.classList.toggle("rrx-in-action-row", Boolean(actionRow));
    if (!tagged) {
      control.badgeWrapper.remove();
    } else {
      const anchor = findBadgeAnchor(header, card);
      if (anchor.nextElementSibling !== control.badgeWrapper) anchor.after(control.badgeWrapper);
    }

    if (actionRow) {
      if (control.wrapper.parentElement !== actionRow) actionRow.append(control.wrapper);
    } else {
      const anchor = tagged && control.badgeWrapper.parentElement
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
        if (change.target.matches('a[href]') && change.target.parentElement?.matches('[role="link"]')) {
          queue(change.target.parentElement.querySelector(":scope > article"));
        }
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
