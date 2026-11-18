// S3 spike background: forward content-script reports; in Firefox, test the page action.
const api = globalThis.browser || globalThis.chrome;
const PORT = __PORT__, BROWSER = "__BROWSER__";
const RUNTIME_HOSTS = ["127.0.0.2"];          // stands in for the server's supported-host list
const post = (o) => fetch(`http://127.0.0.1:${PORT}/report`, {method: "POST", body: JSON.stringify({browser: BROWSER, ...o})});
api.runtime.onMessage.addListener((m) => { post(m); });
if (api.pageAction) {
  api.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === "complete" && tab.url && RUNTIME_HOSTS.includes(new URL(tab.url).hostname)) api.pageAction.show(tabId);
  });
}
api.runtime.onInstalled.addListener(async () => {
  const urls = {staticMatch: `http://127.0.0.1:${PORT}/`, runtimeList: `http://127.0.0.2:${PORT}/`, neither: `http://localhost:${PORT}/`};
  const tabs = {};
  for (const [k, u] of Object.entries(urls)) tabs[k] = (await api.tabs.create({url: u})).id;
  if (!api.pageAction) { post({pageAction: "absent"}); return; }
  await new Promise(r => setTimeout(r, 5000));
  const shown = {};
  for (const [k, id] of Object.entries(tabs)) shown[k] = await api.pageAction.isShown({tabId: id});
  post({pageAction: shown});
});
