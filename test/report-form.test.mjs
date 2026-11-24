import assert from "node:assert/strict";
import test from "node:test";

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
