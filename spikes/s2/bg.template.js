// S2 spike background. VARIANT: none | icon10 | icon1 | poll
const api = globalThis.browser || globalThis.chrome;
const PORT = __PORT__, VARIANT = "__VARIANT__", WINDOW_MS = 90000;
const instance = Math.random().toString(36).slice(2, 10), started = Date.now();
let ticks = 0, lastTick = 0, frame = 0;
const report = (kind, extra = {}) => fetch(`http://127.0.0.1:${PORT}/report`, {method: "POST",
  body: JSON.stringify({kind, variant: VARIANT, instance, started, ticks, lastTick, now: Date.now(), ...extra})});
function ring(angle) {
  const c = new OffscreenCanvas(32, 32), g = c.getContext("2d");
  g.lineWidth = 4; g.strokeStyle = "#3b82f6"; g.beginPath();
  g.arc(16, 16, 12, angle, angle + Math.PI * 1.4); g.stroke();
  return g.getImageData(0, 0, 32, 32);
}
function startLoop() {
  const end = Date.now() + WINDOW_MS;
  const step = { icon10: 100, icon1: 1000, poll: 2000, none: 1000 }[VARIANT];
  const id = setInterval(async () => {
    if (Date.now() > end) { clearInterval(id); return; }
    ticks += 1; lastTick = Date.now();
    if (VARIANT.startsWith("icon")) { frame = (frame + 1) % 12; await api.action.setIcon({imageData: {32: ring(frame * Math.PI / 6)}}); }
    if (VARIANT === "poll") { try { await (await fetch(`http://127.0.0.1:${PORT}/status`)).text(); } catch (e) {} }
  }, step);
}
api.runtime.onInstalled.addListener(async () => {
  await api.alarms.create("s2-check", {when: Date.now() + WINDOW_MS + 15000});
  await report("start");
  startLoop();
});
api.alarms.onAlarm.addListener(async (a) => { if (a.name === "s2-check") await report("check"); });
