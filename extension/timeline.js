(() => {
  const { parsePostLink, handlePattern } = globalThis.replyReportLinks;
  const cardSelector = 'article[data-testid="tweet"]';
  const headerSelector = '[data-testid="User-Name"]';
  // X marks regular username and timestamp anchors with role="link" too.
  const quoteSelector = '[data-testid="quoteTweet"], [role="link"]:not(a)';
  const controls = new WeakMap();
  const dirtyCards = new Set();
  const narrowLayout = window.matchMedia("(max-width: 640px)");
  let reviewed = new Set();
  let enabled = true;
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
      return { post, handle: post.handle, header, timestamp, showBadgesBelow: isOpenPost };
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
    const button = document.createElement("button");
    button.type = "button";
    const label = document.createElement("span");
    label.className = "rrx-tag rrx-tag-status";
    const text = document.createElement("span");
    const source = document.createElement("strong");
    source.textContent = "blockedforaireply.levels.io";
    text.append("Blocked on ", source);
    label.append(text);
    const error = document.createElement("span");
    error.setAttribute("role", "status");
    error.className = "rrx-error";
    error.hidden = true;
    wrapper.append(button, label, error);

    const control = { wrapper, button, label, error, opening: false, url: "" };
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
    const selection = enabled && card.isConnected ? selectPost(card) : null;
    const listed = selection && reviewed.has(selection.handle.toLowerCase());
    if (!selection?.post && !listed) {
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
      control.label.title = `@${handle} is on the reviewed list`;
    }

    control.button.hidden = listed;
    const buttonText = narrowLayout.matches ? "Report" : "Report AI Post";
    if (control.button.textContent !== buttonText) control.button.textContent = buttonText;
    control.label.hidden = !listed;
    control.wrapper.classList.toggle("rrx-listed", Boolean(listed));
    const badgeBelow = listed && (showBadgesBelow || narrowLayout.matches);
    control.wrapper.classList.toggle("rrx-under-author", Boolean(badgeBelow));
    if (listed) control.error.hidden = true;

    const actionRow = listed ? null : findActionRow(card);
    control.wrapper.classList.toggle("rrx-in-action-row", Boolean(actionRow));
    if (badgeBelow) {
      if (control.wrapper.parentElement !== header) header.append(control.wrapper);
    } else if (actionRow) {
      if (control.wrapper.parentElement !== actionRow) actionRow.append(control.wrapper);
    } else {
      const anchor = timestamp && header.contains(timestamp) ? timestamp : header;
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

  chrome.storage.local.get(["reviewedList", "showInlineControls"]).then(values => {
    reviewed = new Set(values.reviewedList?.handles ?? []);
    enabled = values.showInlineControls !== false;
    queueAll();
    narrowLayout.addEventListener("change", queueAll);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.reviewedList) reviewed = new Set(changes.reviewedList.newValue?.handles ?? []);
      if (changes.showInlineControls) enabled = changes.showInlineControls.newValue !== false;
      if (changes.reviewedList || changes.showInlineControls) queueAll();
    });

    new MutationObserver(records => {
      if (!enabled) return;
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
