/**
 * tools/tracker_apps.js
 * 应用映射列表
 */
export const name = "tracker_apps";
export const description = "查看已注册的应用映射 — 进程名、显示名、分类";
export const parameters = { type: "object", properties: {} };

export async function execute(input, ctx) {
  const st = await import("../lib/storage.js");
  const data = st.getAllAppMappings().map(m => ({
    processName: m.processName,
    displayName: m.displayName,
    category: m.category,
  }));
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}
