import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInThisContext } from "node:vm";

test("report form prefills the saved X username with the selected post", async t => {
  const globalNames = ["chrome", "document", "location"];
  const previousGlobals = new Map(globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => {
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  class Element {
    constructor() {
      this.children = [];
      this.dispatchedEvents = [];
      this.style = {};
      this.value = "";
      this.open = false;
    }

    addEventListener() {}
    append(...children) { this.children.push(...children); }
    after() {}
    dispatchEvent(event) { this.dispatchedEvents.push(event); }
    focus() { this.focused = true; }
    setAttribute() {}
    select() {}
  }

  const dialog = new Element();
  const postInput = new Element();
  const reporterInput = new Element();
  const form = {
    querySelector(selector) {
      if (selector.includes("tweet_url")) return postInput;
      if (selector.includes("reporter")) return reporterInput;
      return null;
    }
  };
  dialog.querySelector = () => form;
  const reportButton = new Element();
  reportButton.click = () => { dialog.open = true; };

  globalThis.location = { pathname: "/", search: "", hash: "" };
  globalThis.document = {
    querySelector(selector) {
      if (selector === "button[data-report]") return reportButton;
      if (selector === "dialog#report") return dialog;
      return null;
    },
    createElement: () => new Element()
  };
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => ({
        ok: true,
        url: "https://x.com/Example/status/123",
        reporter: "@my_reporter"
      })
    }
  };

  await import("../extension/report-form.js?reporter-prefill-test");
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(postInput.value, "https://x.com/Example/status/123");
  assert.equal(reporterInput.value, "@my_reporter");
  assert.equal(reporterInput.dispatchedEvents.length, 1);
});

test("recovery remains inside an open dialog without replacing an existing post", async t => {
  const globalNames = ["chrome", "document", "location", "MutationObserver"];
  const previousGlobals = new Map(globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => {
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  class Element {
    constructor() {
      this.children = [];
      this.style = {};
      this.listeners = {};
    }
    append(...children) { this.children.push(...children); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    setAttribute() {}
  }
  const postInput = { value: "https://x.com/Existing/status/456" };
  const form = { querySelector: selector => selector.includes("tweet_url") ? postInput : null };
  const dialog = new Element();
  dialog.open = false;
  dialog.querySelector = () => form;
  const reportButton = { click() { dialog.open = true; } };
  const body = new Element();
  let deadline;
  t.mock.method(globalThis, "setTimeout", callback => { deadline = callback; return 1; });
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.location = { pathname: "/", search: "", hash: "" };
  globalThis.document = {
    body,
    createElement: () => new Element(),
    querySelector(selector) {
      if (selector === "button[data-report]") return reportButton;
      if (selector === "dialog#report" || selector === "dialog[open]") return dialog;
      return null;
    }
  };
  globalThis.chrome = {
    runtime: { sendMessage: async () => ({ url: "https://x.com/Example/status/123" }) }
  };
  await runInThisContext(await readFile(new URL("../extension/report-form.js", import.meta.url), "utf8"));
  deadline();
  assert.equal(postInput.value, "https://x.com/Existing/status/456");
  assert.equal(body.children.length, 0);
  assert.equal(dialog.children.length, 1);
  const panel = dialog.children[0];
  assert.doesNotMatch(panel.style.cssText, /position:fixed/);
  assert.equal(panel.children[2].value, "https://x.com/Example/status/123");

  dialog.children = [];
  dialog.open = false;
  document.querySelector = () => null;
  deadline();
  assert.equal(body.children.length, 1);
  assert.match(body.children[0].style.cssText, /position:fixed/);
});
