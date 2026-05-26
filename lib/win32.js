import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const koffi = req("koffi");

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");
const psapi = koffi.load("psapi.dll");

const GetForegroundWindow = user32.func("long GetForegroundWindow()");
const GetWindowTextW = user32.func("int GetWindowTextW(long hWnd, char16_t *buf, int bufLen)");
const GetWindowThreadProcessId = user32.func("int GetWindowThreadProcessId(long hWnd, long *outPid)");
const GetLastInputInfo = user32.func("int GetLastInputInfo(long *lpi)");
const GetTickCount = kernel32.func("int GetTickCount()");

const OpenProcess = kernel32.func("long OpenProcess(int dwDesiredAccess, int bInheritHandle, int dwProcessId)");
const CloseHandle = kernel32.func("int CloseHandle(long hObject)");

const GetModuleBaseNameW = psapi.func("int GetModuleBaseNameW(long hProcess, long hModule, char16_t *buf, int bufLen)");

const PROCESS_QUERY_INFORMATION = 0x0400;
const PROCESS_VM_READ = 0x0010;

function logErr(msg, err) {
  try { console.error("[hana-time-tracker]", msg, err?.message || err); } catch (_) {}
}

export function getForegroundInfo() {
  const hwnd = GetForegroundWindow();
  if (!hwnd) return { hwnd: 0, title: "", pid: 0, processName: "" };

  const buf = Buffer.alloc(1024);
  const titleLen = GetWindowTextW(hwnd, buf, 512);
  const title = titleLen > 0 ? buf.toString("utf16le").slice(0, titleLen) : "";

  const pidBuf = Buffer.alloc(4);
  GetWindowThreadProcessId(hwnd, pidBuf);
  const pid = pidBuf.readInt32LE(0);

  const processName = pid > 0 ? getProcessName(pid) : "";

  return { hwnd, title, pid, processName };
}

export function getProcessName(pid) {
  let processName = "";
  let hProcess = 0;
  try {
    hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
    if (hProcess) {
      const nameBuf = Buffer.alloc(512);
      const nameLen = GetModuleBaseNameW(hProcess, 0, nameBuf, 256);
      if (nameLen > 0) processName = nameBuf.toString("utf16le").slice(0, nameLen);
    }
  } catch (e) {
    logErr("getProcessName failed for pid " + pid, e);
  } finally {
    if (hProcess) CloseHandle(hProcess);
  }
  return processName;
}

export function getIdleSeconds() {
  try {
    const buf = Buffer.alloc(8);
    buf.writeInt32LE(8, 0);
    const result = GetLastInputInfo(buf);
    if (result) {
      const dwTime = buf.readInt32LE(4);
      const now = GetTickCount();
      const idleMs = now - dwTime;
      const corrected = idleMs < 0 ? idleMs + 0x100000000 : idleMs;
      return Math.floor(corrected / 1000);
    }
  } catch (e) {
    logErr("getIdleSeconds failed", e);
  }
  return 0;
}