/**
 * tools/tracker_date.js
 * 按日期查询时间统计 — 指定日期的总活跃时间、应用排行、时间线
 */
export const name = "tracker_date";
export const description = "获取指定日期的活动统计：总活跃时间、各应用使用时长排行。支持 YYYY-MM-DD 格式日期，或关键字 today/yesterday";
export const parameters = {
  type: "object",
  properties: {
    date: {
      type: "string",
      description: "查询日期，YYYY-MM-DD 格式，或 today / yesterday。省略时默认为 today",
    },
    startDate: {
      type: "string",
      description: "日期范围起始（与 endDate 搭配使用，覆盖 date 参数）",
    },
    endDate: {
      type: "string",
      description: "日期范围结束（与 startDate 搭配使用）",
    },
  },
};

function resolveRange(input) {
  const now = new Date();

  if (input.startDate && input.endDate) {
    // 显式范围
    return {
      start: input.startDate + "T00:00:00.000Z",
      end: input.endDate + "T23:59:59.999Z",
      label: `${input.startDate} ~ ${input.endDate}`,
    };
  }

  let target;
  if (!input.date || input.date === "today") {
    target = now;
  } else if (input.date === "yesterday") {
    target = new Date(now);
    target.setDate(target.getDate() - 1);
  } else {
    // 解析 YYYY-MM-DD
    const match = input.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return { error: `无效日期格式: "${input.date}"，请使用 YYYY-MM-DD` };
    }
    target = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }

  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, "0");
  const d = String(target.getDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${d}`;

  return {
    start: dateStr + "T00:00:00.000Z",
    end: dateStr + "T23:59:59.999Z",
    label: dateStr,
  };
}

export async function execute(input, ctx) {
  const st = await import("../lib/storage.js");

  const range = resolveRange(input);
  if (range.error) {
    return {
      content: [{ type: "text", text: range.error }],
    };
  }

  const sessions = st.getSessionsByDate(range.start, range.end);
  const appMap = {};
  let totalSec = 0;

  sessions.forEach(s => {
    const dur = (s.endTime ? new Date(s.endTime) - new Date(s.startTime) : 0) / 1000;
    if (dur <= 0) return;
    totalSec += dur;
    const m = st.getAppMapping(s.processName) || {};
    const dName = m.displayName || s.processName;
    appMap[s.processName] = appMap[s.processName] || { name: dName, min: 0 };
    appMap[s.processName].min += Math.round(dur / 60);
  });

  const data = {
    date: range.label,
    totalActiveMin: Math.round(totalSec / 60),
    totalActiveSec: Math.round(totalSec),
    sessionCount: sessions.length,
    apps: Object.values(appMap).sort((a, b) => b.min - a.min),
  };

  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}
