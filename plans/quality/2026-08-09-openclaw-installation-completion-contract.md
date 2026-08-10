# OpenClaw 安装完成契约实施计划

日期：2026-08-09

## 实施顺序

1. 建立统一的 OpenClaw Setup 客户端，解析官方 `openclaw.setup.detect` 与 `openclaw.setup.verify` 响应。
2. 将首次启动的配置完成判定切换到 `openclaw.setup.detect.setupComplete`；检测方法明确不受支持时，转入同一 Gateway 的官方 Wizard，不以本地状态跳过。
3. 从配置核验、Wizard 终态和 Dashboard 入口删除追加的实时模型验证门禁。
4. 保留 Gateway 服务交接、认证连接、运行时身份和所选目标核验。
5. 删除无消费者的安装验证类型、文案、测试和旧文件。
6. 将未完成官方 Wizard 的恢复收敛为无答案 `wizard.next`，不调用会销毁会话的 `wizard.status`。
7. 更新安装总览、流程预览和项目状态。
8. 运行定向回归、完整前端测试、静态检查、生产构建、差异检查和 Emoji 扫描。

## 验证顺序

1. Setup 客户端协议解析测试。
2. 安装完成门禁单元测试。
3. 首次启动与 Wizard 回归测试。
4. 渲染进程重启后的 Wizard session 恢复回归测试。
5. `pnpm lint`、`pnpm test` 和 `pnpm build`。
6. Tauri 本地安装包与真实 Gateway 流程验收。
