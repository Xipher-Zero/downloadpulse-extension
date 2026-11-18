// S1 spike background: get the tracker's cookies, then fetch the torrent two ways.
const api = globalThis.browser || globalThis.chrome;
const PORT = __PORT__, BROWSER = "__BROWSER__";
const SAME = `http://127.0.0.1:${PORT}/file.torrent`, CROSS = `http://localhost:${PORT}/file.torrent`;
const results = {browser: BROWSER, ua: navigator.userAgent};
async function probe(url) {
  try { const r = await fetch(url, {credentials: "include"}); return {status: r.status, body: await r.json()}; }
  catch (e) { return {error: String(e)}; }
}
let content = null;
api.runtime.onMessage.addListener((msg) => { if (msg && msg.s1content) content = msg.s1content; });
async function run() {
  try { results.hostPermission = await api.permissions.contains({origins: [`http://127.0.0.1/*`, `http://localhost/*`]}); } catch (e) { results.hostPermission = String(e); }
  // Log in on site B (localhost) first, top-level, then on site A (127.0.0.1), whose page links to both.
  await api.tabs.create({url: `http://localhost:${PORT}/login`});
  await new Promise(r => setTimeout(r, 1500));
  const tab = await api.tabs.create({url: `http://127.0.0.1:${PORT}/login`});
  for (let i = 0; i < 40 && !content; i += 1) await new Promise(r => setTimeout(r, 250));
  results.background = {same: await probe(SAME), cross: await probe(CROSS)};
  results.content = content;
  await fetch(`http://127.0.0.1:${PORT}/report`, {method: "POST", body: JSON.stringify(results)});
}
api.runtime.onInstalled.addListener(() => { run(); });
