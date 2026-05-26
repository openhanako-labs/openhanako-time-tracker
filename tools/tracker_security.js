/**
 * tools/tracker_security.js
 * 最近安全日志
 */
export const name = "tracker_security";
export const description = "查看最近的安全事件日志 — 高风险进程、深夜活动、敏感命令";
export const parameters = { type: "object", properties: {} };

export async function execute(input, ctx) {
  const st = await import("../lib/storage.js");
  const data = st.getSecurityLogs(20);
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}
