import * as storage from "./storage.js";
import * as win32 from "./win32.js";

let currentSessionId = null;
let currentProcessName = null;
let idleSince = null;
let isIdle = false;
let lastProcessName = null;
let lastSwitchTime = 0;

// 连续活跃追踪
let continuousActiveStart = null;
let lastBreakReminderTime = null;
let _pendingBreakReminder = null;

let IDLE_THRESHOLD_SEC = 300;
const SWITCH_DEBOUNCE_MS = 3000;
const BREAK_REMINDER_COOLDOWN_MS = 10 * 60 * 1000; // 10分钟冷却

export function loadConfig() {
  const val = storage.getSetting("idle_threshold_sec");
  if (val) IDLE_THRESHOLD_SEC = parseInt(val, 10) || 300;
}

export function tick(info) {
  const now = new Date().toISOString();
  const idleSec = win32.getIdleSeconds();

  if (idleSec >= IDLE_THRESHOLD_SEC && !isIdle) {
    isIdle = true;
    idleSince = now;
    lastProcessName = currentProcessName;
    continuousActiveStart = null;
    lastBreakReminderTime = null;
    if (currentSessionId !== null) {
      storage.sealSession(currentSessionId, now, "idle");
      currentSessionId = null;
    }
    return { action: "idle_enter", detail: `空闲 ${idleSec}s，暂停记录` };
  }

  if (idleSec < IDLE_THRESHOLD_SEC && isIdle) {
    isIdle = false;
    idleSince = null;
    continuousActiveStart = now;
    const processName = info.processName || lastProcessName || "unknown";
    const id = storage.insertSession({ startTime: now, appName: info.title || processName, processName, windowTitle: info.title });
    currentSessionId = id;
    currentProcessName = processName;
    return { action: "idle_exit", detail: `恢复记录，空闲 ${Math.floor(idleSec)}s` };
  }

  if (isIdle) return { action: "none", detail: "idle" };

  const processName = info.processName || "";
  if (!processName) return { action: "none", detail: "无进程" };

  // 非空闲状态下初始化连续活跃起点
  if (continuousActiveStart === null) {
    continuousActiveStart = now;
  }

  if (processName !== currentProcessName) {
    const nowMs = Date.now();

    if (currentSessionId !== null && (nowMs - lastSwitchTime) < SWITCH_DEBOUNCE_MS) {
      storage.sealSession(currentSessionId, now, "debounce_switch");
      currentSessionId = null;
      currentProcessName = null;
      return { action: "debounce", detail: `切换太快忽略: ${processName}` };
    }

    if (currentSessionId !== null) {
      storage.sealSession(currentSessionId, now, "switch");
    }

    const id = storage.insertSession({ startTime: now, appName: info.title || processName, processName, windowTitle: info.title });
    currentSessionId = id;
    currentProcessName = processName;
    lastSwitchTime = nowMs;

    return { action: "new", detail: `切换到 ${processName}` };
  }

  // 检查久坐提醒
  checkBreakReminder();

  return { action: "none", detail: "same" };
}

function checkBreakReminder() {
  if (isIdle || continuousActiveStart === null) return;

  const breakEnabled = storage.getSetting("break_reminder_enabled");
  if (breakEnabled !== "1" && breakEnabled !== "true") return;

  const breakMinutes = parseInt(storage.getSetting("break_reminder_minutes") || "90", 10);
  if (breakMinutes < 1) return;

  const continuousMin = (Date.now() - new Date(continuousActiveStart).getTime()) / 60000;
  if (continuousMin < breakMinutes) return;

  const nowMs = Date.now();
  if (lastBreakReminderTime !== null && (nowMs - lastBreakReminderTime) < BREAK_REMINDER_COOLDOWN_MS) return;

  lastBreakReminderTime = nowMs;
  _pendingBreakReminder = {
    time: new Date().toISOString(),
    continuousMinutes: Math.floor(continuousMin),
    message: `连续工作 ${Math.floor(continuousMin)} 分钟，该起来活动一下了`
  };
}

export function getPendingBreakReminder() {
  return _pendingBreakReminder;
}

export function clearPendingBreakReminder() {
  _pendingBreakReminder = null;
  continuousActiveStart = new Date().toISOString();
  lastBreakReminderTime = Date.now();
}

export function getStatus() {
  let duration = 0;
  if (currentSessionId !== null) {
    const session = storage.getActiveSession();
    if (session) {
      duration = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000);
    }
  }
  return { isIdle, currentProcessName, currentSessionId, duration, idleSince };
}

export function shutdown() {
  if (currentSessionId !== null) {
    storage.sealSession(currentSessionId, new Date().toISOString(), "shutdown");
    currentSessionId = null;
  }
  storage.save();
}