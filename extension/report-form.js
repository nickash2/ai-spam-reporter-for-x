(async () => {
  if (location.pathname !== "/" || location.search || location.hash) return;

  const draft = await chrome.runtime.sendMessage({ type: "report-draft" }).catch(() => null);
  if (!draft?.url) return;

  function recoveryPanel(input, inDialog = false) {
    const panel = document.createElement(input ? "div" : "aside");
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = input
      ? "Post link filled in. Review it before sending."
      : "AI Spam Reporter for X couldn’t fill the form. Copy the link, then paste it into “Report AI reply bot”.";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "pill";
    copy.textContent = "Copy link";
    copy.style.minHeight = "44px";
    panel.style.cssText = input || inDialog
      ? "display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-block:8px;font-size:13px"
      : "position:fixed;bottom:16px;right:16px;z-index:2147483647;box-sizing:border-box;width:min(400px,calc(100vw - 32px));padding:16px;background:white;color:#202124;border:1px solid #999;border-radius:10px;font:14px system-ui";
    status.style.margin = "0";
    panel.append(status, copy);

    const field = input ?? document.createElement("input");
    if (!input) {
      field.readOnly = true;
      field.value = draft.url;
      field.setAttribute("aria-label", "Selected post link");
      field.style.width = "100%";
      panel.append(field);
    }

    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(draft.url);
        status.textContent = "Post link copied.";
      } catch {
        field.focus();
        field.select();
        status.textContent = "Copy the selected link.";
      }
    });
    return panel;
  }

  function fillReport() {
    const button = document.querySelector("button[data-report]");
    const dialog = document.querySelector("dialog#report");
    const form = dialog?.querySelector("form#report-form");
    const input = form?.querySelector("input[name='tweet_url'][type='url']");
    const reporterInput = form?.querySelector("input[name='reporter']");
    if (!button || !input) return false;

    if (!dialog.open) button.click();
    if (!dialog.open || (input.value && input.value !== draft.url)) return false;

    input.value = draft.url;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (input.value !== draft.url) return false;
    const reporter = typeof draft.reporter === "string" ? draft.reporter.trim().replace(/^@/, "") : "";
    if (reporterInput && !reporterInput.value &&
        /^[a-z0-9_]{1,15}$/i.test(reporter)) {
      reporterInput.value = `@${reporter}`;
      reporterInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    input.after(recoveryPanel(input));
    input.focus();
    return true;
  }

  if (fillReport()) return;

  const observer = new MutationObserver(() => {
    if (fillReport()) {
      observer.disconnect();
      clearTimeout(deadline);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const deadline = setTimeout(() => {
    observer.disconnect();
    const dialog = document.querySelector("dialog[open]");
    (dialog ?? document.body).append(recoveryPanel(undefined, Boolean(dialog)));
  }, 3500);
})();
