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
  const actionSelector = '[data-testid="reply"], [data-testid="like"], [data-testid="unlike"], a[href^="/compose/post?in_reply_to="]';
  let card;
  let feedCell;
  let virtualRow;
  let group;
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

    closest(selector) {
      if (selector === cardSelector) return card;
      if (selector === groupSelector) return group;
      if (selector === '[data-testid="cellInnerDiv"]' && this === card) return feedCell;
      if (selector === "li[data-index]" && this === card) return virtualRow;
      return null;
    }

    contains(element) {
      return this === element || this.children.includes(element);
    }

    querySelector(selector) {
      return this.name === "post-link" && selector === "time" ? new Element("time") : null;
    }

    querySelectorAll(selector) {
      if (this === card && selector === '[data-testid="User-Name"]') return modern ? [] : [header];
      if (this === card && selector === groupSelector) return [group];
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

  const listeners = {};
  const stored = {
    reviewedList: { handles: [] },
    removedAccounts: { handles: ["former_user"], removedAt: { former_user: "2026-11-20" } },
    showInlineControls: true,
    hideBlockedAccounts: false,
    showPreviouslyBlocked: true
  };
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
  globalThis.location = { href: "https://x.com/home", origin: "https://x.com" };
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
  globalThis.MutationObserver = class {
    constructor() {}
    observe() {}
  };
  globalThis.document = {
    body: new Element("body"),
    createElement: name => new Element(name),
    querySelectorAll: selector => selector === cardSelector ? [card, quotedCard] : []
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
  const badgeWrapper = header.children.find(element =>
    element.classList.contains("rrx-inline") && element.classList.contains("rrx-listed")
  );
  const [reportButton] = wrapper.children;
  const [badge] = badgeWrapper.children;

  assert.equal(reportButton.hidden, false);
  assert.match(badge.textContent, /Previously blocked · Removed/);

  assert.equal(wrapper.parentElement, group);
  assert.equal(badgeWrapper.parentElement, header);

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
  assert.equal(badgeWrapper.parentElement, header);

  listeners.changed({ reviewedList: { newValue: { handles: ["former_user"] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(reportButton.hidden, true);
  assert.equal(badge.textContent, "Blocked on blockedforaireply.com");

  listeners.changed({ reviewedList: { newValue: { handles: [] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(reportButton.hidden, false);
  assert.match(badge.textContent, /Previously blocked · Removed/);

  modern = true;
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
  assert.equal(badgeWrapper.parentElement, header);

  outerLink.href = "https://x.com/Another_User/status/456";
  listeners.changed({ reviewedList: { newValue: { handles: [] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(wrapper.parentElement, null);
  assert.equal(badgeWrapper.parentElement, null);

  outerLink.href = postLink.href;
  listeners.changed({ reviewedList: { newValue: { handles: ["former_user"] } } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  const modernBadge = header.children.find(element => element.classList.contains("rrx-listed"));
  assert.equal(modernBadge.children[0].textContent, "Blocked on blockedforaireply.com");

  container.matches = () => false;
  globalThis.location.href = postLink.href;
  listeners.changed({ hideBlockedAccounts: { newValue: true } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(card["data-rrx-hidden"], false);
  assert.equal(feedCell["data-rrx-hidden"], false);
  assert.equal(virtualRow["data-rrx-collapsed"], false);
  assert.equal(modernBadge.parentElement, header);

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

  listeners.changed({ hideBlockedAccounts: { newValue: false } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(card["data-rrx-hidden"], false);
  assert.equal(feedCell["data-rrx-hidden"], false);
  assert.equal(virtualRow["data-rrx-collapsed"], false);

  listeners.changed({ showInlineControls: { newValue: false } }, "local");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(modernBadge.parentElement, null);
});
