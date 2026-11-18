// S1 spike content script on the tracker page: fetch the same files from the page context.
(async () => {
  const api = globalThis.browser || globalThis.chrome;
  async function probe(url) {
    try { const r = await fetch(url, {credentials: "include"}); return {status: r.status, body: await r.json()}; }
    catch (e) { return {error: String(e)}; }
  }
  const same = document.getElementById("same").href, cross = document.getElementById("cross").href;
  api.runtime.sendMessage({s1content: {same: await probe(same), cross: await probe(cross)}});
})();
