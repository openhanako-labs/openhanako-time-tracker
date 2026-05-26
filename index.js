import fs from "node:fs";
import path from "node:path";

export default class HanaTimeTrackerPlugin {
  async onload() {
    const { log, pluginDir, dataDir, config } = this.ctx;
    log.info("hana-time-tracker loaded");

    // 数据目录（plugin-data/hana-time-tracker/）
    const dbDir = dataDir || path.join(pluginDir, "data");
    fs.mkdirSync(dbDir, { recursive: true });

    // 迁移：旧 DB 在插件目录 → 移到 plugin-data
    const oldDb = path.join(pluginDir, "hana-time-tracker.db");
    const newDb = path.join(dbDir, "hana-time-tracker.db");
    if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) {
      fs.copyFileSync(oldDb, newDb);
      log.info("数据库已迁移到 plugin-data");
    }

    // 配置
    const pollingIntervalMs = config.get("pollingIntervalMs") || 2000;
    const idleThresholdSec = config.get("idleThresholdSec") || 300;

    // 1. 初始化存储层
    const storage = await import("./lib/storage.js");
    await storage.init(dbDir);
    storage.startAutoSave();
    this.register(() => storage.stopAutoSave());

    // 2. 初始化安全检测
    const security = await import("./lib/security.js");
    security.loadConfig(storage);

    // 3. session 加载配置
    const session = await import("./lib/session.js");
    session.loadConfig();

    // 4. 启动轮询
    const poller = await import("./lib/poller.js");
    poller.start(pollingIntervalMs, (event) => {
      if (event.type === "tick") {
        const state = globalThis[Symbol.for("hana-time-tracker.state")] || {};
        state.lastTick = event.time;
        state.currentApp = event.info.processName;
        state.sessionAction = event.sessionAction;
        globalThis[Symbol.for("hana-time-tracker.state")] = state;

        // 久坐提醒：通过上下文发送系统通知
        if (event.sessionAction && event.sessionAction.action === "break_reminder") {
          this.trySendNotification(event.sessionAction.detail).catch(e => log.error("通知失败:", e?.message));
        }
      }
    });
    this.register(() => {
      poller.stop();
    });

    // 6. 每日数据清理（启动后 1 分钟首次执行）
    const retentionDays = parseInt(storage.getSetting("data_retention_days") || "365", 10);
    const cleanupInterval = 24 * 60 * 60 * 1000;
    const cleanupTimer = setInterval(() => {
      try { storage.cleanupOldData(retentionDays); log.info(`定期清理完成（保留 ${retentionDays} 天）`); } catch (e) { log.error("清理失败:", e.message); }
    }, cleanupInterval);
    this.register(() => clearInterval(cleanupTimer));
    const initialCleanupTimer = setTimeout(() => {
      try { storage.cleanupOldData(retentionDays); log.info(`初次清理完成（保留 ${retentionDays} 天）`); } catch (e) { log.error("初次清理失败:", e.message); }
    }, 60000);
    this.register(() => clearTimeout(initialCleanupTimer));

    log.info(`hana-time-tracker initialized (interval ${pollingIntervalMs}ms, idle ${idleThresholdSec}s)`);
  }
}