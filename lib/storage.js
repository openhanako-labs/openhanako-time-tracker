import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const req = createRequire(import.meta.url);

let SQL = null;
let db = null;
let dbPath = "";
let ready = false;
let dirty = false;
let saveIntervalId = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time TEXT NOT NULL,
    end_time TEXT,
    app_name TEXT NOT NULL,
    process_name TEXT NOT NULL,
    window_title TEXT,
    is_active INTEGER DEFAULT 1,
    idle_seconds INTEGER DEFAULT 0,
    sealed_by TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_time);
  CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active);

  CREATE TABLE IF NOT EXISTS app_mappings (
    process_name TEXT PRIMARY KEY,
    display_name TEXT,
    category TEXT,
    color TEXT,
    exclude_stats INTEGER DEFAULT 0,
    capture_title INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS security_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    process_name TEXT NOT NULL,
    window_title TEXT,
    reason TEXT NOT NULL,
    severity TEXT DEFAULT 'low',
    action_taken TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  INSERT OR IGNORE INTO app_mappings (process_name, display_name, category, exclude_stats) VALUES
    ('obsidian.exe', 'Obsidian', 'writing', 0),
    ('notion.exe', 'Notion', 'writing', 0),
    ('typora.exe', 'Typora', 'writing', 0),
    ('notepad.exe', '记事本', 'writing', 0),
    ('notepad++.exe', 'Notepad++', 'writing', 0),
    ('code.exe', 'VS Code', 'development', 0),
    ('cursor.exe', 'Cursor', 'development', 0),
    ('windsurf.exe', 'Windsurf', 'development', 0),
    ('sublime_text.exe', 'Sublime Text', 'development', 0),
    ('nvim.exe', 'Neovim', 'development', 0),
    ('nvim-qt.exe', 'Neovim Qt', 'development', 0),
    ('windowsterminal.exe', 'Terminal', 'development', 0),
    ('wezterm-gui.exe', 'WezTerm', 'development', 0),
    ('chrome.exe', 'Chrome', 'browsing', 0),
    ('msedge.exe', 'Edge', 'browsing', 0),
    ('firefox.exe', 'Firefox', 'browsing', 0),
    ('brave.exe', 'Brave', 'browsing', 0),
    ('hanako.exe', 'Hanako', 'communication', 0),
    ('qq.exe', 'QQ', 'communication', 0),
    ('wechat.exe', '微信', 'communication', 0),
    ('telegram.exe', 'Telegram', 'communication', 0),
    ('discord.exe', 'Discord', 'communication', 0),
    ('slack.exe', 'Slack', 'communication', 0),
    ('spotify.exe', 'Spotify', 'entertainment', 0),
    ('potplayermini64.exe', 'PotPlayer', 'entertainment', 0),
    ('steam.exe', 'Steam', 'gaming', 0),
    ('pixpin.exe', 'PixPin', 'design', 0),
    ('everything.exe', 'Everything', 'system', 1),
    ('taskmgr.exe', '任务管理器', 'system', 1),
    ('explorer.exe', '文件管理器', 'system', 1),
    ('searchhost.exe', '搜索', 'system', 1),
    ('textinputhost.exe', '输入法', 'system', 1),
    ('snippingtool.exe', '截图工具', 'system', 1),
    ('systemsettings.exe', '设置', 'system', 1)
  ;

  INSERT OR IGNORE INTO settings (key, value) VALUES
    ('idle_threshold_sec', '300'),
    ('poll_interval_ms', '2000'),
    ('data_retention_days', '365'),
    ('night_start_hour', '0'),
    ('night_end_hour', '6'),
    ('capture_title', '1');
`;

export async function init(dbDir) {
  if (!SQL) {
    const initSqlJs = req("sql.js");
    SQL = await initSqlJs();
  }

  dbPath = path.join(dbDir, "hana-time-tracker.db");

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(SCHEMA);
  markDirty();

  try {
    db.run("ALTER TABLE app_mappings ADD COLUMN pinned INTEGER DEFAULT 0");
    markDirty();
  } catch (_) {}

  save();
  ready = true;
}

export function markDirty() { dirty = true; }

function save() {
  if (!db || !dirty) return;
  try {
    const data = db.export();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = dbPath + ".tmp";
    fs.writeFileSync(tmpPath, Buffer.from(data));
    fs.renameSync(tmpPath, dbPath);
    dirty = false;
  } catch (e) {
    console.error("[hana-time-tracker] 数据持久化失败:", e.message);
  }
}

export function startAutoSave() {
  if (saveIntervalId) return;
  saveIntervalId = setInterval(() => { if (dirty) save(); }, 30000);
}

export function stopAutoSave() {
  if (saveIntervalId) { clearInterval(saveIntervalId); saveIntervalId = null; }
  if (dirty) save();
}

export function isReady() { return ready && db !== null; }

export function insertSession({ startTime, appName, processName, windowTitle }) {
  const captureTitle = getSetting("capture_title");
  const title = (captureTitle === "0" || captureTitle === "false") ? "" : (windowTitle || "");
  db.run(
    "INSERT INTO sessions (start_time, app_name, process_name, window_title, is_active) VALUES (?, ?, ?, ?, 1)",
    [startTime, appName, processName, title]
  );
  const result = db.exec("SELECT last_insert_rowid()");
  const id = result[0]?.values?.[0]?.[0] || 0;
  markDirty();
  return id;
}

export function sealSession(id, endTime, sealedBy) {
  db.run("UPDATE sessions SET end_time = ?, is_active = 0, sealed_by = ? WHERE id = ?", [endTime, sealedBy, id]);
  markDirty();
}

export function getActiveSession() {
  const result = db.exec("SELECT * FROM sessions WHERE is_active = 1 ORDER BY id DESC LIMIT 1");
  if (!result[0]?.values?.length) return null;
  return rowToSession(result[0].values[0]);
}

export function getTodaySessions() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const result = db.exec("SELECT * FROM sessions WHERE start_time >= ? AND start_time < ? ORDER BY start_time", [today, tomorrow.toISOString().slice(0, 10)]);
  if (!result[0]?.values?.length) return [];
  return result[0].values.map(rowToSession);
}

export function getSessionsByDate(startDate, endDate) {
  const result = db.exec("SELECT * FROM sessions WHERE start_time >= ? AND start_time < ? ORDER BY start_time", [startDate, endDate]);
  if (!result[0]?.values?.length) return [];
  return result[0].values.map(rowToSession);
}

export function getAppMapping(processName) {
  const result = db.exec("SELECT * FROM app_mappings WHERE process_name = ?", [processName]);
  if (!result[0]?.values?.length) return null;
  const row = result[0].values[0];
  return { processName: row[0], displayName: row[1], category: row[2], color: row[3], excludeStats: !!row[4], captureTitle: !!row[5] };
}

export function getAllAppMappings() {
  const result = db.exec("SELECT * FROM app_mappings ORDER BY pinned DESC, category, process_name");
  if (!result[0]?.values?.length) return [];
  return result[0].values.map(rowToMapping);
}

export function getPinnedMappings() {
  const result = db.exec("SELECT * FROM app_mappings WHERE pinned = 1 ORDER BY process_name");
  if (!result[0]?.values?.length) return [];
  return result[0].values.map(rowToMapping);
}

export function upsertAppMapping({ processName, displayName, category, excludeStats }) {
  db.run(
    `INSERT INTO app_mappings (process_name, display_name, category, exclude_stats)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(process_name) DO UPDATE SET
       display_name = excluded.display_name,
       category = excluded.category,
       exclude_stats = excluded.exclude_stats`,
    [processName, displayName, category, excludeStats ? 1 : 0]
  );
  markDirty();
}

export function setPinned(processName, pinned) {
  db.run("UPDATE app_mappings SET pinned = ? WHERE process_name = ?", [pinned ? 1 : 0, processName]);
  markDirty();
}

export function getTimeline() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const result = db.exec(
    "SELECT start_time, end_time, process_name FROM sessions WHERE start_time >= ? AND start_time < ? AND end_time IS NOT NULL ORDER BY start_time",
    [today, tomorrowStr]
  );

  // 24 小时全刻度
  const hours = new Array(24).fill(null).map((_, h) => ({ hour: h, minutes: 0, apps: new Set() }));

  // 批量加载 app mappings 消除 N+1
  const allMappings = {};
  getAllAppMappings().forEach(m => { allMappings[m.processName.toLowerCase()] = m; });
  function getDisplayName(proc) {
    const m = allMappings[proc.toLowerCase()];
    return m ? m.displayName : proc;
  }

  if (result[0]?.values?.length) {
    result[0].values.forEach(([start, end, proc]) => {
      const s = new Date(start);
      const e = new Date(end);
      if (isNaN(s) || isNaN(e)) return;

      const durMin = (e - s) / 60000;
      if (durMin <= 0) return;

      const startHour = s.getHours();
      const endHour = e.getHours();
      const startMin = s.getMinutes();
      const endMin = e.getMinutes();

      if (startHour === endHour) {
        hours[startHour].minutes += durMin;
        hours[startHour].apps.add(proc);
      } else {
        // 逐小时拆分，支持跨越 3+ 小时的情况
        let remaining = durMin;
        let h = startHour;
        const maxIter = 48;
        for (let i = 0; i < maxIter && remaining > 0.001; i++) {
          let cap;
          if (h === startHour) {
            cap = 60 - startMin;          // 第一小时：到整点
          } else if (h === endHour) {
            cap = Math.max(0, endMin);    // 最后一小时：到结束分钟
          } else {
            cap = 60;                      // 中间小时：整小时
          }
          if (cap <= 0) { h = (h + 1) % 24; continue; }
          const chunk = Math.min(remaining, cap);
          hours[h].minutes += chunk;
          hours[h].apps.add(proc);
          remaining -= chunk;
          h = (h + 1) % 24;
        }
      }
    });
  }

  return hours.map(h => ({
    hour: h.hour,
    minutes: Math.round(Math.max(0, h.minutes)),
    apps: [...h.apps].map(p => getDisplayName(p)),
  }));
}

export function getActiveDayCount() {
  const result = db.exec("SELECT COUNT(DISTINCT substr(start_time, 1, 10)) FROM sessions");
  return result[0]?.values?.[0]?.[0] || 0;
}

export function getActiveDays() {
  const result = db.exec("SELECT DISTINCT substr(datetime(start_time, 'localtime'), 1, 10) AS day FROM sessions ORDER BY day DESC LIMIT 365");
  if (!result[0]?.values?.length) return [];
  return result[0].values.map(r => r[0]);
}

export function getDailyTotals(days = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const result = db.exec(
    `SELECT substr(datetime(s.start_time, 'localtime'), 1, 10) AS day,
            SUM(CAST(strftime('%s', s.end_time) AS INTEGER) - CAST(strftime('%s', s.start_time) AS INTEGER)) AS total_sec
     FROM sessions s
     JOIN app_mappings m ON s.process_name = m.process_name
     WHERE s.start_time >= ? AND s.end_time IS NOT NULL AND (m.exclude_stats IS NULL OR m.exclude_stats = 0)
     GROUP BY day ORDER BY day`,
    [cutoffStr]
  );
  if (!result[0]?.values?.length) return [];
  return result[0].values.map(r => ({ date: r[0], totalSec: Number(r[1]) }));
}

export function insertSecurityLog({ time, processName, windowTitle, reason, severity, actionTaken }) {
  db.run(
    "INSERT INTO security_log (time, process_name, window_title, reason, severity, action_taken) VALUES (?, ?, ?, ?, ?, ?)",
    [time, processName, windowTitle || "", reason, severity || "low", actionTaken || null]
  );
  markDirty();
}

export function getSecurityLogs(limit = 50) {
  const result = db.exec("SELECT * FROM security_log ORDER BY time DESC LIMIT ?", [limit]);
  if (!result[0]?.values?.length) return [];
  return result[0].values.map(row => ({ id: row[0], time: row[1], processName: row[2], windowTitle: row[3], reason: row[4], severity: row[5], actionTaken: row[6] }));
}

export function getSetting(key) {
  const result = db.exec("SELECT value FROM settings WHERE key = ?", [key]);
  return result[0]?.values?.[0]?.[0] || null;
}

export function setSetting(key, value) {
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, String(value)]);
  markDirty();
}

export function sealAllActive(reason) {
  const now = new Date().toISOString();
  db.run("UPDATE sessions SET end_time = ?, is_active = 0, sealed_by = ? WHERE is_active = 1", [now, reason]);
  markDirty();
}

export function cleanupOldData(retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  db.run("DELETE FROM sessions WHERE start_time < ?", [cutoff]);
  db.run("DELETE FROM security_log WHERE time < ?", [cutoff]);
  markDirty();
}

function rowToSession(row) {
  return { id: row[0], startTime: row[1], endTime: row[2], appName: row[3], processName: row[4], windowTitle: row[5], isActive: !!row[6], idleSeconds: row[7] || 0, sealedBy: row[8] };
}

function rowToMapping(row) {
  return { processName: row[0], displayName: row[1], category: row[2], color: row[3], excludeStats: !!row[4], captureTitle: !!row[5], pinned: !!row[6] };
}