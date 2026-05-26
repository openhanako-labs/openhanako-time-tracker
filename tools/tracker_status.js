/**
 * tools/tracker_status.js
 * 当前时间追踪状态 — 是否空闲、当前应用、连续活跃时长
 */
export const name = "tracker_status";
export const description = "获取当前时间追踪状态 — 是否空闲、当前应用、连续活跃时长";
export const parameters = { type: "object", properties: {} };

export async function execute(input, ctx) {
  const sess = await import("../lib/session.js");
  return sess.getStatus();
}