/**
 * tools/tracker_today.js
 * 今日时间统计摘要
 */
export const name = "tracker_today";
export const description = "获取今日时间统计摘要 — 总活跃时间、各应用使用时长排行、安全事件数";
export const parameters = { type: "object", properties: {} };

export async function execute(input, ctx) {
  const st = await import("../lib/storage.js");
  const sessions = st.getTodaySessions();
  const appMap = {};
  let totalSec = 0;
  sessions.forEach(s => {
    const dur = (s.endTime ? new Date(s.endTime) - new Date(s.startTime) : 0) / 1000;
    if (dur <= 0) return;
    totalSec += dur;
    const m = st.getAppMapping(s.processName) || {};
    const d = m.displayName || s.processName;
    appMap[s.processName] = appMap[s.processName] || { name: d, min: 0 };
    appMap[s.processName].min += Math.round(dur / 60);
  });
  return {
    totalActiveMin: Math.round(totalSec / 60),
    sessionCount: sessions.length,
    apps: Object.values(appMap).sort((a, b) => b.min - a.min),
    securityCount: st.getSecurityLogs(100).length,
  };
}