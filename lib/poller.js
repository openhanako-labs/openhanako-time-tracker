import * as win32 from "./win32.js";
import * as session from "./session.js";
import * as security from "./security.js";

let intervalId = null;
let onEvent = null;

const POLL_INTERVAL_MS_DEFAULT = 2000;
let POLL_INTERVAL_MS = POLL_INTERVAL_MS_DEFAULT;

export function start(intervalMs, callback) {
  if (intervalId) return;
  if (typeof intervalMs === 'function') { callback = intervalMs; intervalMs = POLL_INTERVAL_MS_DEFAULT; }
  if (intervalMs) POLL_INTERVAL_MS = intervalMs;
  onEvent = callback;
  tick();
  intervalId = setInterval(tick, POLL_INTERVAL_MS);
}

export function stop() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  onEvent = null;
  session.shutdown();
}

function tick() {
  try {
    const info = win32.getForegroundInfo();
    const now = new Date().toISOString();

    if (!info.processName) return;

    const secResult = security.check({ processName: info.processName, windowTitle: info.title, time: now });
    const sessionAction = session.tick(info);

    if (onEvent) {
      onEvent({ type: "tick", time: now, info, sessionAction, securityResult: secResult });
    }
  } catch (e) {
    if (onEvent) onEvent({ type: "error", time: new Date().toISOString(), error: e.message });
  }
}

export function tickNow() { tick(); }