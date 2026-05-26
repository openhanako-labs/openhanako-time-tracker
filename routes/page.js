import fs from "node:fs";
import path from "node:path";

const VALID_RANGES = ["today", "week", "month", "all"];

function esc(str) {
  return String(str).replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isValidDate(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  return !isNaN(Date.parse(str + "T00:00:00"));
}

export default function (app, ctx) {
  const base = "/api/plugins/" + ctx.pluginId;
  const htmlPath = path.join(ctx.pluginDir, "public", "tracker-dashboard.html");

  // 根路径 — 健康检查/卸载通知
  app.get("/", async (c) => {
    return c.json({ ok: true, plugin: ctx.pluginId, version: "0.5.0" });
  });
  app.get("", async (c) => {
    return c.json({ ok: true, plugin: ctx.pluginId, version: "0.5.0" });
  });
  app.post("/", async (c) => {
    return c.json({ ok: true, plugin: ctx.pluginId });
  });
  app.post("", async (c) => {
    return c.json({ ok: true, plugin: ctx.pluginId });
  });

  app.get("/dashboard", async (c) => {
    try {
      const theme = c.req.query("hana-theme") || "dark";
      const hanaCss = c.req.query("hana-css") || "";
      const hcLink = hanaCss ? `<link rel="stylesheet" href="${esc(hanaCss)}">` : "";
      const data = await buildData();
      const jsonStr = JSON.stringify(data).replace(/</g, "\\u003c");

      let html = fs.readFileSync(htmlPath, "utf-8");
      html = html.replace("<body", `<body data-hana-theme="${esc(theme)}" data-surface="page"`);
      html = html.replace("</head>", hcLink + `<script>window.__INITIAL_DATA__ = ${jsonStr};</script></head>`);

      return c.html(html);
    } catch (e) {
      return c.html(`<!doctype html><html><body style="background:#1a1a2e;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui"><p>⚠ ${e.message}</p></body></html>`);
    }
  });

  // 动态数据 API
  app.get("/data", async (c) => {
    const range = VALID_RANGES.includes(c.req.query("range")) ? c.req.query("range") : "today";
    const startDate = c.req.query("start");
    const endDate = c.req.query("end");
    return c.json(await buildRangeData(range, startDate, endDate));
  });

  // 导出 CSV（默认最近 30 天）
  app.get("/export", async (c) => {
    try {
      const storage = await import("../lib/storage.js");
      if (!storage.isReady()) return c.body("存储层未就绪，无法导出", 503, { "Content-Type": "text/plain; charset=utf-8" });

      const d = new Date();
      const end = localDateStr(d) + "T23:59:59.999Z";
      d.setDate(d.getDate() - 30);
      const start = localDateStr(d) + "T00:00:00.000Z";

      const sessions = storage.getSessionsByDate(start, end);
      let csv = "\uFEFF进程名,显示名,开始时间,结束时间,时长(秒),窗口标题\n";
      sessions.forEach(s => {
        const mapping = storage.getAppMapping(s.processName) || {};
        const dur = s.endTime ? Math.round((new Date(s.endTime) - new Date(s.startTime)) / 1000) : 0;
        const title = (s.windowTitle || "").replace(/"/g, "\"\"").slice(0, 200);
        csv += `${s.processName},${mapping.displayName || s.processName},${s.startTime},${s.endTime || ""},${dur},"${title}"\n`;
      });

      return c.body(csv, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="time-tracker_${localDateStr(new Date())}.csv"`
      });
    } catch (e) {
      return c.body("导出失败: " + e.message, 500, { "Content-Type": "text/plain; charset=utf-8" });
    }
  });

  // 导出 Markdown 日报
  app.get("/export/markdown", async (c) => {
    try {
      const storage = await import("../lib/storage.js");
      if (!storage.isReady()) return c.body("存储层未就绪", 503);

      const now = new Date();
      const today = localDateStr(now);
      const sessions = storage.getSessionsByDate(today + "T00:00:00.000Z", today + "T23:59:59.999Z");

      let totalSec = 0;
      const appMap = {};
      sessions.forEach(s => {
        const dur = (s.endTime ? new Date(s.endTime) - new Date(s.startTime) : 0) / 1000;
        if (dur <= 0) return;
        totalSec += dur;
        const mapping = storage.getAppMapping(s.processName) || {};
        const display = mapping.displayName || s.processName;
        appMap[s.processName] = appMap[s.processName] || { display, duration: 0 };
        appMap[s.processName].duration += dur;
      });

      const titleMap = {};
      sessions.forEach(s => {
        const t = s.windowTitle || "";
        if (!t) return;
        const dur = (s.endTime ? new Date(s.endTime) - new Date(s.startTime) : 0) / 1000;
        titleMap[t] = (titleMap[t] || 0) + dur;
      });

      let md = `# 时间统计日报 — ${today}\n\n`;
      md += `## 概览\n\n`;
      md += `- **总活跃时间**: ${Math.round(totalSec / 60)} 分钟\n`;
      md += `- **会话片段**: ${sessions.length} 个\n`;
      md += `- **应用数**: ${Object.keys(appMap).length} 个\n\n`;
      md += `## 应用排行\n\n`;
      md += `| 应用 | 时长 |\n|------|------|\n`;
      Object.entries(appMap).sort((a,b) => b[1].duration - a[1].duration).forEach(([_, v]) => {
        md += `| ${v.display} | ${Math.round(v.duration / 60)} 分钟 |\n`;
      });

      if (Object.keys(titleMap).length) {
        md += `\n## 窗口标题 TOP 10\n\n`;
        Object.entries(titleMap).sort((a,b) => b[1] - a[1]).slice(0, 10).forEach(([t, dur]) => {
          md += `- ${t.slice(0, 80)} — ${Math.round(dur / 60)} 分钟\n`;
        });
      }

      md += `\n---\n*由 Hanako Time Tracker 自动生成 — ${now.toISOString().slice(0, 19).replace("T", " ")}*\n`;

      return c.body(md, 200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="日报_${today}.md"`
      });
    } catch (e) {
      return c.body("导出失败: " + e.message, 500, { "Content-Type": "text/plain; charset=utf-8" });
    }
  });

  // 导出到指定目录
  app.get("/export/save", async (c) => {
    try {
      const storage = await import("../lib/storage.js");
      if (!storage.isReady()) return c.json({ error: "存储层未就绪" }, 503);

      const type = c.req.query("type") || "csv";
      const exportDir = storage.getSetting("export_dir");
      if (!exportDir) return c.json({ error: "未设置导出目录，请先在设置中配置" }, 400);

      const now = new Date();
      const today = localDateStr(now);

      if (type === "markdown") {
        const sessions = storage.getSessionsByDate(today + "T00:00:00.000Z", today + "T23:59:59.999Z");
        let totalSec = 0;
        const appMap = {};
        sessions.forEach(s => {
          const dur = (s.endTime ? new Date(s.endTime) - new Date(s.startTime) : 0) / 1000;
          if (dur <= 0) return;
          totalSec += dur;
          const mapping = storage.getAppMapping(s.processName) || {};
          const display = mapping.displayName || s.processName;
          appMap[s.processName] = appMap[s.processName] || { display, duration: 0 };
          appMap[s.processName].duration += dur;
        });
        const titleMap = {};
        sessions.forEach(s => {
          const t = s.windowTitle || "";
          if (!t) return;
          const dur = (s.endTime ? new Date(s.endTime) - new Date(s.startTime) : 0) / 1000;
          titleMap[t] = (titleMap[t] || 0) + dur;
        });
        let md = `# 时间统计日报 — ${today}\n\n## 概览\n\n`;
        md += `- **总活跃时间**: ${Math.round(totalSec / 60)} 分钟\n- **会话片段**: ${sessions.length} 个\n- **应用数**: ${Object.keys(appMap).length} 个\n\n`;
        md += `## 应用排行\n\n| 应用 | 时长 |\n|------|------|\n`;
        Object.entries(appMap).sort((a,b) => b[1].duration - a[1].duration).forEach(([_, v]) => {
          md += `| ${v.display} | ${Math.round(v.duration / 60)} 分钟 |\n`;
        });
        if (Object.keys(titleMap).length) {
          md += `\n## 窗口标题 TOP 10\n\n`;
          Object.entries(titleMap).sort((a,b) => b[1] - a[1]).slice(0, 10).forEach(([t, dur]) => {
            md += `- ${t.slice(0, 80)} — ${Math.round(dur / 60)} 分钟\n`;
          });
        }
        md += `\n---\n*由 Hanako Time Tracker 自动生成 — ${now.toISOString().slice(0, 19).replace("T", " ")}*\n`;
        const filename = `日报_${today}.md`;
        const filepath = path.join(exportDir, filename);
        fs.mkdirSync(exportDir, { recursive: true });
        fs.writeFileSync(filepath, md, "utf-8");
        return c.json({ ok: true, filepath, filename });
      } else {
        // CSV
        const d = new Date();
        const end = localDateStr(d) + "T23:59:59.999Z";
        d.setDate(d.getDate() - 30);
        const start = localDateStr(d) + "T00:00:00.000Z";
        const sessions = storage.getSessionsByDate(start, end);
        let csv = "\uFEFF进程名,显示名,开始时间,结束时间,时长(秒),窗口标题\n";
        sessions.forEach(s => {
          const mapping = storage.getAppMapping(s.processName) || {};
          const dur = s.endTime ? Math.round((new Date(s.endTime) - new Date(s.startTime)) / 1000) : 0;
          const title = (s.windowTitle || "").replace(/"/g, "\"\"").slice(0, 200);
          csv += `${s.processName},${mapping.displayName || s.processName},${s.startTime},${s.endTime || ""},${dur},"${title}"\n`;
        });
        const filename = `time-tracker_${today}.csv`;
        const filepath = path.join(exportDir, filename);
        fs.mkdirSync(exportDir, { recursive: true });
        fs.writeFileSync(filepath, csv, "utf-8");
        return c.json({ ok: true, filepath, filename });
      }
    } catch (e) {
      return c.json({ error: e.message }, 500);
    }
  });

  // 同步昨日数据（对比用）
  app.get("/data/yesterday", async (c) => {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = localDateStr(yesterday);
      const start = yStr + "T00:00:00.000Z";
      const end = yStr + "T23:59:59.999Z";

      const storage = await import("../lib/storage.js");
      if (!storage.isReady()) return c.json({ error: "未就绪" });

      const sessions = storage.getSessionsByDate(start, end);
      const appMap = {};
      let totalSec = 0;

      sessions.forEach(s => {
        const dur = (s.endTime ? new Date(s.endTime) - new Date(s.startTime) : 0) / 1000;
        if (dur <= 0) return;
        totalSec += dur;
        const mapping = storage.getAppMapping(s.processName) || {};
        const cat = mapping.category || "other";
        const display = mapping.displayName || s.processName;
        if (!appMap[cat]) appMap[cat] = { display: cat, duration: 0 };
        appMap[cat].duration += dur;
      });

      return c.json({
        date: yStr,
        totalActiveSec: Math.round(totalSec),
        categories: Object.fromEntries(Object.entries(appMap).map(([k, v]) => [k, Math.round(v.duration)])),
        sessionCount: sessions.length,
      });
    } catch (e) {
      return c.json({ error: e.message }, 500);
    }
  });

  // Pin / Unpin
  app.post("/pin", async (c) => {
    try {
      const storage = await import("../lib/storage.js");
      const body = await c.req.json();
      const { action, processName } = body;
      if (!processName) return c.json({ error: "processName required" }, 400);
      storage.setPinned(processName, action === "pin");
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e.message }, 500);
    }
  });

  app.post("/goal", async (c) => {
    try {
      const storage = await import("../lib/storage.js");
      const body = await c.req.json();
      const { goals, goalNames } = body;
      if (goals && typeof goals === 'object') storage.setSetting("goals", JSON.stringify(goals));
      if (goalNames && typeof goalNames === 'object') storage.setSetting("goalNames", JSON.stringify(goalNames));
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e.message }, 500);
    }
  });

  // 通用设置保存
  app.post("/settings", async (c) => {
    try {
      const storage = await import("../lib/storage.js");
      const body = await c.req.json();
      const { key, value } = body;
      if (!key) return c.json({ error: "key required" }, 400);
      storage.setSetting(key, String(value));
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e.message }, 500);
    }
  });

  // 清除久坐提醒
  app.post("/dismiss-break-reminder", async (c) => {
    try {
      const session = await import("../lib/session.js");
      session.clearPendingBreakReminder();
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e.message }, 500);
    }
  });
}

function buildData() {
  return buildRangeData("today");
}

async function buildRangeData(range, startDate, endDate) {
  try {
    const storage = await import("../lib/storage.js");
    if (!storage.isReady()) return { today: null, apps: [], security: [], note: "存储层未就绪" };

    const now = new Date();
    const today = localDateStr(now);
    let start, end;

    if (startDate && endDate && isValidDate(startDate) && isValidDate(endDate)) {
      start = startDate + "T00:00:00.000Z";
      end = endDate + "T23:59:59.999Z";
    } else {
      switch (range) {
        case "week": {
          const d = new Date(now);
          d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
          start = localDateStr(d) + "T00:00:00.000Z";
          end = today + "T23:59:59.999Z";
          break;
        }
        case "month":
          start = today.slice(0, 7) + "-01T00:00:00.000Z";
          end = today + "T23:59:59.999Z";
          break;
        case "all":
          start = "2020-01-01T00:00:00.000Z";
          end = today + "T23:59:59.999Z";
          break;
        default:
          start = today + "T00:00:00.000Z";
          end = today + "T23:59:59.999Z";
      }
    }

    const sessions = storage.getSessionsByDate(start, end);
    const appMap = {};
    const catMap = {};
    let activeSec = 0;

    // 批量加载 app mappings 消除 N+1
    const allMappings = {};
    storage.getAllAppMappings().forEach(m => { allMappings[m.processName.toLowerCase()] = m; });
    function getMapping(proc) { return allMappings[proc.toLowerCase()] || {}; }

    sessions.forEach(s => {
      const duration = (s.endTime ? new Date(s.endTime) - new Date(s.startTime) : 0) / 1000;
      const proc = s.processName.toLowerCase();
      const mapping = getMapping(proc);
      const cat = mapping.category || "other";
      const display = mapping.displayName || s.processName;
      const exclude = mapping.excludeStats;

      if (!appMap[proc]) appMap[proc] = { display, duration: 0, category: cat, exclude };
      appMap[proc].duration += duration;
      if (!exclude) {
        catMap[cat] = (catMap[cat] || 0) + duration;
        activeSec += duration;
      }
    });

    return {
      range,
      apiBase: "/api/plugins/hana-time-tracker",
      today: { apps: appMap, categories: catMap, totalActiveSec: Math.round(activeSec), sessionCount: sessions.length },
      timeline: range === "today" ? storage.getTimeline() : null,
      activeDays: storage.getActiveDayCount(),
      consecutiveDays: getConsecutiveDays(storage),
      topTitles: getTopTitles(storage, start, end),
      dailyTotals: storage.getDailyTotals(range === 'all' ? 365 : 90),
      goals: getGoalSettings(storage),
      goalNames: getGoalNameSettings(storage),
      pinned: storage.getPinnedMappings().map(m => m.processName),
      breakReminder: await getBreakReminder(),
      breakReminderEnabled: storage.getSetting("break_reminder_enabled"),
      breakReminderMinutes: storage.getSetting("break_reminder_minutes"),
      exportDir: storage.getSetting("export_dir"),
      apps: storage.getAllAppMappings().map(m => ({
        processName: m.processName, displayName: m.displayName,
        category: m.category || "other", exclude: !!m.excludeStats, pinned: !!m.pinned,
      })),
      security: storage.getSecurityLogs(50),
    };
  } catch (e) {
    return { error: e.message, today: null, apps: [], security: [] };
  }
}

function getConsecutiveDays(storage) {
  const now = new Date();
  const todayStr = localDateStr(now);
  const todayResult = storage.getSessionsByDate(todayStr + "T00:00:00.000Z", todayStr + "T23:59:59.999Z");
  if (!todayResult.length) return 0;
  // 一条 SQL 拉所有活跃日，避免 365 次查询
  const allDays = storage.getActiveDays();
  if (!allDays || allDays.length === 0) return 1;
  let streak = 1;
  for (let i = 1; i < 365; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = localDateStr(d);
    if (allDays.includes(ds)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function getTopTitles(storage, start, end) {
  const sessions = storage.getSessionsByDate(start, end);
  const titleMap = {};
  sessions.forEach(s => {
    let title = s.windowTitle || "";
    if (!title) return;
    // 截断窗口标题（太长）
    if (title.length > 80) title = title.slice(0, 77) + "...";
    const duration = (s.endTime ? new Date(s.endTime) - new Date(s.startTime) : 0) / 1000;
    titleMap[title] = (titleMap[title] || 0) + duration;
  });
  return Object.entries(titleMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([title, sec]) => ({ title, duration: Math.round(sec) }));
}

function getGoalSettings(storage) {
  const raw = storage.getSetting("goals");
  const defaults = { writing: 180, development: 240, browsing: 60, communication: 90, design: 60, entertainment: 120, gaming: 120, other: 30 };
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function getGoalNameSettings(storage) {
  const raw = storage.getSetting("goalNames");
  const defaults = { writing: '写作', development: '开发', browsing: '浏览', communication: '沟通', design: '设计', entertainment: '娱乐', gaming: '游戏', other: '其他' };
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

async function getBreakReminder() {
  try {
    const session = await import("../lib/session.js");
    const r = session.getPendingBreakReminder();
    if (!r) return { triggered: false };
    return {
      triggered: true,
      continuousMinutes: r.continuousMinutes,
      message: r.message,
      time: r.time
    };
  } catch {
    return { triggered: false };
  }
}