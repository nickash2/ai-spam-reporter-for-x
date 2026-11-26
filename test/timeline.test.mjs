import assert from "node:assert/strict";
import test from "node:test";
import "../extension/reply.mjs";

test("timeline controls support legacy and newer post markup", async t => {
  const globalNames = ["chrome", "document", "location", "MutationObserver", "requestAnimationFrame", "window"];
  const previousGlobals = new Map(globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => {
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  const cardSelector = 'article[data-testid="tweet"], article:not([data-testid])';
  const groupSelector = '[role="group"]';
  const actionSelector = '[data-testid="reply"], [data-testid="like"], [data-testid="unlike"], a[href^="/compose/post?in_reply_to="], a[href$="/analytics"], button[aria-label*="Like"], button[aria-label*="Repost"], button[aria-label*="Bookmark"]';
  let card;
  let siblingCard;
  let siblingCards = [];
  let feedCell;
  let virtualRow;
  let group;
  let hasActionRow = true;
  let header;
  let anchors;
  let modern = false;

  class Element {
    constructor(name) {
      this.name = name;
      this.children = [];
      this.listeners = {};
      this.classes = new Set();
      this.classList = {
        toggle: (className, enabled) => enabled ? this.classes.add(className) : this.classes.delete(className),
        contains: className => this.classes.has(className)
      };
      this.hidden = false;
      this.isConnected = true;
      this.parentElement = null;
    }

    append(...children) {
      if (children.length) this._textContent = undefined;
      for (const child of children) {
        if (typeof child === "string") {
          this.children.push(child);
          continue;
        }
        child.parentElement?.removeChild(child);
        child.parentElement = this;
        this.children.push(child);
      }
    }

    replaceChildren(...children) {
      this.children = [];
      this._textContent = undefined;
      this.append(...children);
    }

    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }

    setAttribute(name, value) {
      this[name] = value;
    }

    toggleAttribute(name, enabled) {
      this[name] = enabled;
    }

    hasAttribute(name) {
      return Boolean(this[name]);
    }

    closest(selector) {
      if (selector === cardSelector) return this === siblingCard ? siblingCard : card;
      if (selector === groupSelector) return group;
      if (selector === '[data-testid="cellInnerDiv"]' && (this === card || this === siblingCard)) return feedCell;
      if (selector === "li[data-index]" && (this === card || this === siblingCard)) return virtualRow;
      return null;
    }

    contains(element) {
      return this === element || this.children.includes(element);
    }

    querySelector(selector) {
      return this.name === "post-link" && selector === "time" ? new Element("time") : null;
    }

    querySelectorAll(selector) {
      if ((this === feedCell || this === virtualRow) && selector === cardSelector) {
        return [card, ...siblingCards, quotedCard];
      }
      if (this === card && selector === '[data-testid="User-Name"]') return modern ? [] : [header];
      if (this === card && selector === groupSelector) return hasActionRow ? [group] : [];
      if (this === card && selector === "a[href]" && modern) return anchors;
      if (this === header && selector === "a[href]") return anchors;
      if (this === group && selector === actionSelector) {
        return [new Element("reply-action")];
      }
      return [];
    }

    get nextElementSibling() {
      if (!this.parentElement) return null;
      const siblings = this.parentElement.children;
      return siblings[siblings.indexOf(this) + 1] ?? null;
    }

    after(element) {
      element.parentElement?.removeChild(element);
      const siblings = this.parentElement.children;
      const index = siblings.indexOf(this);
      element.parentElement = this.parentElement;
      siblings.splice(index + 1, 0, element);
    }

    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        this.parentElement = null;
      }
    }

    removeChild(element) {
      this.children = this.children.filter(child => child !== element);
      element.parentElement = null;
    }

    set className(value) {
      this._className = value;
      this.classes = new Set(value.split(/\s+/).filter(Boolean));
    }

    get className() {
      return this._className;
    }

    get textContent() {
      return this._textContent ?? this.children.map(child =>
        typeof child === "string" ? child : child.textContent
      ).join("");
    }

    set textContent(value) {
      this._textContent = String(value);
      this.children = [];
    }
  }

  card = new Element("tweet-card");
  feedCell = new Element("feed-cell");
  virtualRow = new Element("virtual-row");
  virtualRow.append(feedCell);
  feedCell.append(card);
  const quotedCard = new Element("quoted-card");
  quotedCard.parentElement = { closest: selector => selector === "article" ? card : null };
  quotedCard.closest = selector => selector === "li[data-index]" ? virtualRow : null;
  group = new Element("action-row");
  header = new Element("author-header");
  const profileLink = new Element("profile-link");
  Object.assign(profileLink, {
    origin: "https://x.com",
    pathname: "/Former_User",
    textContent: "@Former_User",
    href: "https://x.com/Former_User"
  });
  const postLink = new Element("post-link");
  Object.assign(postLink, {
    origin: "https://x.com",
    pathname: "/Former_User/status/123",
    textContent: "",
    href: "https://x.com/Former_User/status/123"
  });
  anchors = [profileLink, postLink];
  header.append(...anchors);
  const authorContainer = new Element("author-container");
  authorContainer.append(header);
  card.append(authorContainer);

  const listeners = {};
  const stored = {
    reviewedList: { handles: [] },
    removedAccounts: { handles: ["former_user"], removedAt: { former_user: "2026-11-20" } },
    showInlineControls: true,
    hideBlockedAccounts: false,
    showPreviouslyBlocked: true
  };
  const narrowLayout = { matches: false, addEventListener(type, listener) { this.listener = listener; } };
  globalThis.window = {
    matchMedia: () => narrowLayout,
    getComputedStyle: element => ({ display: "flex", flexDirection: element.name === "author-row" ? "row" : "column" })
  };
  globalThis.location = { href: "https://x.com/home", origin: "https://x.com" };
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
  globalThis.MutationObserver = class {
    constructor() {}
    observe() {}
  };
  globalThis.document = {
    body: new Element("body"),
    createElement: name => new Element(name),
    querySelectorAll: selector => selector === cardSelector ? [card, ...siblingCards, quotedCard] : []
  };
  globalThis.chrome = {
    runtime: {
      id: "test-extension",
      onMessage: { addListener(listener) { listeners.message = listener; } },
      sendMessage: async () => ({ ok: true })
    },
    storage: {
      local: { get: async () => stored },
      onChanged: { addListener(listener) { listeners.changed = listener; } }
    }
  };

  await import("../extension/timeline.js");
  await new Promise(resolve => setTimeout(resolve, 10));
  const wrapper = group.children.find(element => element.classList.contains("rrx-inline"));
  const badgeWrapper = authorContainer.children.find(element =>
    element.classList.contains("rrx-inline") && element.classList.contains("rrx-listed")
  );
  const [reportButton] = wrapper.children;
  const [badge] = badgeWrapper.children;

  assert.equal(reportButton.hidden, false);
  assert.equal(badge.textContent, "Previously blocked");
  assert.equal(badge.title, "Previously blocked on blockedforaireply.com");

  assert.equal(wrapper.parentElement, group);
  assert.equal(badgeWrapper.parentElement, authorContainer);
  assert.equal(header.nextElementSibling, badgeWrapper);

  listeners.changed({
    removedAccounts: { newValue: { handles: [], removedAt: {} } }
  }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(reportButton.hidden, false);
  assert.equal(badgeWrapper.parentElement, null);

  listeners.changed({
    removedAccounts: {
      newValue: { handles: ["former_user"], removedAt: { former_user: "2026-11-20" } }
    }
  }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(reportButton.hidden, false);
  assert.equal(badgeWrapper.parentElement, authorContainer);

  listeners.changed({ reviewedList: { newValue: { handles: ["former_user"] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(reportButton.hidden, true);
  assert.equal(badge.textContent, "Blocked on blockedforaireply.com");
  assert.equal(badge.title, "Blocked on blockedforaireply.com");

  narrowLayout.matches = true;
  narrowLayout.listener();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(badge.textContent, "Blocked");
  assert.equal(badge.title, "Blocked on blockedforaireply.com");
  assert.equal(header.nextElementSibling, badgeWrapper);
  narrowLayout.matches = false;
  narrowLayout.listener();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(badge.textContent, "Blocked on blockedforaireply.com");

  listeners.changed({ reviewedList: { newValue: { handles: [] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(reportButton.hidden, false);
  assert.equal(badge.textContent, "Previously blocked");

  modern = true;
  const authorRow = new Element("author-row");
  authorContainer.append(authorRow);
  authorRow.append(header);
  const container = new Element("post-container");
  container.matches = selector => selector === '[role="link"]';
  container.closest = () => null;
  const outerLink = new Element("outer-link");
  outerLink.href = postLink.href;
  outerLink.matches = selector => selector === "a[href]";
  container.append(outerLink, card);
  listeners.changed({ reviewedList: { newValue: { handles: [] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(reportButton.hidden, false);
  assert.equal(wrapper.parentElement, group);
  assert.equal(badgeWrapper.parentElement, authorContainer);
  assert.equal(authorRow.nextElementSibling, badgeWrapper);

  // If the bottom action row is absent, never fall back to placing the Report button in the author header.
  hasActionRow = false;
  listeners.changed({ reviewedList: { newValue: { handles: [] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(wrapper.parentElement, null);
  assert.equal(badgeWrapper.parentElement, authorContainer);
  hasActionRow = true;
  listeners.changed({ reviewedList: { newValue: { handles: [] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(wrapper.parentElement, group);

  outerLink.href = "https://x.com/Another_User/status/456";
  listeners.changed({ reviewedList: { newValue: { handles: [] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(wrapper.parentElement, null);
  assert.equal(badgeWrapper.parentElement, null);

  outerLink.href = postLink.href;
  listeners.changed({ reviewedList: { newValue: { handles: ["former_user"] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  const modernBadge = authorContainer.children.find(element => element.classList.contains("rrx-listed"));
  assert.equal(modernBadge.children[0].textContent, "Blocked on blockedforaireply.com");

  container.matches = () => false;
  globalThis.location.href = postLink.href;
  listeners.changed({ hideBlockedAccounts: { newValue: true } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(card["data-rrx-hidden"], false);
  assert.equal(feedCell["data-rrx-hidden"], false);
  assert.equal(virtualRow["data-rrx-collapsed"], false);
  assert.equal(modernBadge.parentElement, authorContainer);

  container.matches = () => true;
  globalThis.location.href = "https://x.com/home";
  listeners.changed({ hideBlockedAccounts: { newValue: true } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(card["data-rrx-hidden"], true);
  assert.equal(feedCell["data-rrx-hidden"], true);
  assert.equal(virtualRow["data-rrx-collapsed"], true);

  listeners.changed({ reviewedList: { newValue: { handles: [] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(virtualRow["data-rrx-collapsed"], false);

  listeners.changed({ reviewedList: { newValue: { handles: ["former_user"] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(virtualRow["data-rrx-collapsed"], true);

  // When a non-blocked reply shares the same virtual row/cell as a blocked reply,
  // only the blocked reply is hidden; the shared container stays visible.
  siblingCard = new Element("sibling-reply-card");
  const siblingHeader = new Element("sibling-header");
  const siblingProfileLink = new Element("sibling-profile-link");
  Object.assign(siblingProfileLink, {
    origin: "https://x.com",
    pathname: "/Parent_Reply",
    textContent: "@Parent_Reply",
    href: "https://x.com/Parent_Reply"
  });
  const siblingPostLink = new Element("sibling-post-link");
  Object.assign(siblingPostLink, {
    origin: "https://x.com",
    pathname: "/Parent_Reply/status/789",
    textContent: "",
    href: "https://x.com/Parent_Reply/status/789"
  });
  siblingHeader.append(siblingProfileLink, siblingPostLink);
  const siblingAuthorContainer = new Element("sibling-author-container");
  siblingAuthorContainer.append(siblingHeader);
  siblingCard.append(siblingAuthorContainer);
  const siblingContainer = new Element("sibling-post-container");
  siblingContainer.matches = selector => selector === '[role="link"]';
  siblingContainer.closest = () => null;
  const siblingOuterLink = new Element("sibling-outer-link");
  siblingOuterLink.href = siblingPostLink.href;
  siblingOuterLink.matches = selector => selector === "a[href]";
  siblingContainer.append(siblingOuterLink, siblingCard);
  siblingCard.querySelectorAll = selector => {
    if (selector === "a[href]") return [siblingProfileLink, siblingPostLink];
    return [];
  };
  siblingProfileLink.closest = selector => selector === cardSelector ? siblingCard : null;
  siblingPostLink.closest = selector => selector === cardSelector ? siblingCard : null;
  const threadList = new Element("thread-list");
  threadList.append(siblingContainer, container);
  siblingCards = [siblingCard];

  listeners.changed({ reviewedList: { newValue: { handles: ["former_user"] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(card["data-rrx-hidden"], true);
  assert.equal(siblingCard["data-rrx-hidden"], false);
  assert.equal(feedCell["data-rrx-hidden"], false);
  assert.equal(virtualRow["data-rrx-collapsed"], false);
  assert.equal(siblingContainer["data-rrx-trim-top"], false);
  assert.equal(siblingContainer["data-rrx-trim-bottom"], true);
  assert.equal(siblingContainer["data-rrx-divider-bottom"], true);

  // When a "Show replies" button follows the hidden reply, keep the connector to the button.
  const showRepliesButton = new Element("show-replies-button");
  threadList.append(showRepliesButton);
  listeners.changed({ reviewedList: { newValue: { handles: ["former_user"] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(siblingContainer["data-rrx-trim-bottom"], false);
  assert.equal(siblingContainer["data-rrx-divider-bottom"], false);
  showRepliesButton.remove();

  // When the hidden reply is above a visible reply, trim the visible reply's top connector.
  threadList.replaceChildren(container, siblingContainer);
  listeners.changed({ reviewedList: { newValue: { handles: ["former_user"] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(siblingContainer["data-rrx-trim-top"], true);
  assert.equal(siblingContainer["data-rrx-trim-bottom"], false);
  assert.equal(siblingContainer["data-rrx-divider-bottom"], false);

  // If every top-level reply in the shared container is blocked, the container collapses.
  listeners.changed({ reviewedList: { newValue: { handles: ["former_user", "parent_reply"] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(card["data-rrx-hidden"], true);
  assert.equal(siblingCard["data-rrx-hidden"], true);
  assert.equal(feedCell["data-rrx-hidden"], true);
  assert.equal(virtualRow["data-rrx-collapsed"], true);

  // Unblocking one reply restores the shared container while keeping the other hidden.
  listeners.changed({ reviewedList: { newValue: { handles: ["former_user"] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(card["data-rrx-hidden"], true);
  assert.equal(siblingCard["data-rrx-hidden"], false);
  assert.equal(feedCell["data-rrx-hidden"], false);
  assert.equal(virtualRow["data-rrx-collapsed"], false);

  listeners.changed({ hideBlockedAccounts: { newValue: false } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(card["data-rrx-hidden"], false);
  assert.equal(feedCell["data-rrx-hidden"], false);
  assert.equal(virtualRow["data-rrx-collapsed"], false);
  assert.equal(siblingContainer["data-rrx-trim-top"], false);
  assert.equal(siblingContainer["data-rrx-trim-bottom"], false);
  assert.equal(siblingContainer["data-rrx-divider-bottom"], false);
  siblingCards = [];

  listeners.changed({ showInlineControls: { newValue: false } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(modernBadge.parentElement, null);
});
