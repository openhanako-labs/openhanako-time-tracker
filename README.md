# Hanako Time Tracker


![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)


Hanako 时间追踪插件 — 本地窗口活动监控与可视化仪表盘。

**功能**：自动轮询前台窗口、应用使用时长统计、安全日志（高风险进程/深夜活动检测）、置顶应用、时间线视图、CSV 导出。

## 安装

### 方法一：下载 Release（推荐）
1. 从 [Releases](https://github.com/Yuexiye/Openhanako-time-tracker/releases) 下载 `hana-time-tracker.zip`
2. 在 Hanako 设置 → 插件面板，拖入 zip 文件
3. 重启 Hanako

### 方法二：从 GitHub 源码安装
1. 从 [GitHub](https://github.com/Yuexiye/Openhanako-time-tracker) 下载源码 ZIP
2. 解压后，将 **整个文件夹**（含 `index.js`, `manifest.json`, `lib/`, `routes/`, `public/`, `node_modules/`）拖入 Hanako 设置 → 插件面板
3. 重启 Hanako

### 方法三：手动安装
1. 解压到 `C:\Users\<用户名>\.hanako\plugins\hanako-time-tracker\`
2. 在解压目录执行 `npm install`
3. 重启 Hanako

## 从源码构建

```bash
git clone https://github.com/Yuexiye/Openhanako-time-tracker.git
cd Openhanako-time-tracker
npm install
# 复制到 Hanako plugins 目录
```

## 依赖

- [koffi](https://koffi.dev/) — Node.js FFI，调用 Windows API
- [sql.js](https://sql.js.org/) — 纯 WASM SQLite，本地存储

## 文档

- 仪表盘：Hanako 侧边栏 → Hanako Time Tracker
- Agent 工具：`tracker_status` / `tracker_today` / `tracker_date` / `tracker_security` / `tracker_apps`

## License

[GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html)