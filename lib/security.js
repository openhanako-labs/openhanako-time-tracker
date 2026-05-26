const DEFAULT_SAFE_PROCESSES = [
  "obsidian.exe", "code.exe", "hanako.exe", "chrome.exe", "msedge.exe", "firefox.exe",
  "explorer.exe", "notepad.exe", "notepad++.exe", "windowsterminal.exe", "wezterm-gui.exe",
  "alacritty.exe", "searchhost.exe", "textinputhost.exe", "systemsettings.exe",
  "applicationframehost.exe", "shellexperiencehost.exe", "taskmgr.exe", "snippingtool.exe",
  "pixpin.exe", "everything.exe", "listary.exe",
];

const HIGH_RISK_PROCESSES = [
  "cmd.exe", "powershell.exe", "pwsh.exe", "regedit.exe", "reg.exe",
  "wscript.exe", "cscript.exe", "mshta.exe", "rundll32.exe",
  "net.exe", "net1.exe", "schtasks.exe", "at.exe", "bitsadmin.exe",
  "certutil.exe", "wmic.exe", "wmiex.exe",
];

const MEDIUM_RISK_PROCESSES = [
  "mmc.exe", "compmgmt.msc", "devmgmt.msc", "diskmgmt.msc", "services.msc",
  "eventvwr.msc", "perfmon.msc", "gpedit.msc", "secpol.msc", "lusrmgr.msc",
  "msconfig.exe", "resmon.exe", "procmon.exe", "procexp.exe",
];

const SENSITIVE_TITLE_KEYWORDS = [
  "whoami", "ipconfig", "netstat", "nslookup", "netsh", "route", "arp -a", "tracert",
  "taskkill", "tasklist", "sc query", "sc stop", "del /f", "rmdir /s",
  "net user", "net localgroup", "net share", "reg add", "reg delete", "reg query",
  "wevtutil", "auditpol", "secedit", "mimikatz", "nc ", "ncat", "procdump",
  "powershell -e", "powershell -enc", "powershell -w hidden",
  "IEX(", "Invoke-Expression", "Invoke-WebRequest", "DownloadString", "DownloadFile",
];

let NIGHT_START_HOUR = 0;
let NIGHT_END_HOUR = 6;
const NIGHT_ALLOWED = [
  "obsidian.exe", "code.exe", "hanako.exe", "chrome.exe", "msedge.exe",
  "firefox.exe", "notepad++.exe", "windowsterminal.exe",
];

export function loadConfig(storage) {
  const start = storage.getSetting("night_start_hour");
  const end = storage.getSetting("night_end_hour");
  if (start !== null) NIGHT_START_HOUR = parseInt(start, 10) || 0;
  if (end !== null) NIGHT_END_HOUR = parseInt(end, 10) || 6;
}

export function check({ processName, windowTitle, time }) {
  const lowerProcess = (processName || "").toLowerCase();
  const lowerTitle = (windowTitle || "").toLowerCase();
  const hour = time ? new Date(time).getHours() : new Date().getHours();

  if (HIGH_RISK_PROCESSES.includes(lowerProcess)) {
    return { safe: false, reason: `高风险进程激活: ${processName}${windowTitle ? " — " + windowTitle : ""}`, severity: "high", shouldAlert: true };
  }

  if (MEDIUM_RISK_PROCESSES.includes(lowerProcess)) {
    return { safe: false, reason: `中风险进程激活: ${processName}${windowTitle ? " — " + windowTitle : ""}`, severity: "medium", shouldAlert: true };
  }

  for (const keyword of SENSITIVE_TITLE_KEYWORDS) {
    if (lowerTitle.includes(keyword.toLowerCase())) {
      return { safe: false, reason: `窗口标题含敏感词 "${keyword}": ${windowTitle} (${processName})`, severity: "high", shouldAlert: true };
    }
  }

  if (isNightHours(hour) && !NIGHT_ALLOWED.includes(lowerProcess)) {
    if (!lowerProcess.includes("host") && !lowerProcess.includes("svc")) {
      return { safe: true, reason: `深夜非白名单应用: ${processName} (${String(hour).padStart(2, "0")}:00)`, severity: "info", shouldAlert: false };
    }
  }

  if (!DEFAULT_SAFE_PROCESSES.includes(lowerProcess) && !lowerProcess.endsWith(".dll") && !lowerProcess.startsWith("svchost")) {
    return { safe: true, reason: `未识别应用: ${processName}`, severity: "low", shouldAlert: false };
  }

  return { safe: true, reason: null, severity: null, shouldAlert: false };
}

function isNightHours(hour) {
  if (NIGHT_START_HOUR < NIGHT_END_HOUR) return hour >= NIGHT_START_HOUR && hour < NIGHT_END_HOUR;
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

export function addToSafeList(processName) {
  const lower = processName.toLowerCase();
  if (!DEFAULT_SAFE_PROCESSES.includes(lower)) DEFAULT_SAFE_PROCESSES.push(lower);
}

export function getSafeList() { return [...DEFAULT_SAFE_PROCESSES]; }