(() => {
  const hosts = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]);
  const reservedHandles = new Set(["i", "web", "intent", "search", "home", "explore", "notifications", "messages", "settings"]);
  const handlePattern = /^[a-z0-9_]{1,15}$/i;

  function parsePostLink(value) {
    if (typeof value !== "string") return null;

    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }

    if (url.protocol !== "https:" || !hosts.has(url.host) || url.username || url.password) return null;

    const match = /^\/([a-z0-9_]{1,15})\/status\/([1-9]\d{0,19})(?:\/(?:photo|video)\/[1-9]\d*)?\/?$/i.exec(url.pathname);
    if (!match) return null;

    const [, handle, postId] = match;
    if (reservedHandles.has(handle.toLowerCase())) return null;

    return { handle, url: `https://x.com/${handle}/status/${postId}` };
  }

  globalThis.replyReportLinks = { parsePostLink, handlePattern };
})();
