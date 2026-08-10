# 协作扩展单一权威契约整改规格

日期：2026-08-09

## 依据

- 协作插件当前运行时输出由 `packages/junqi-collab/src/service.ts` 定义。
- 桌面端读取边界由 `src/services/collaboration/wire-codec.ts` 和
  `src/services/collaboration/client.ts` 定义。
- 安装级维护所有者由 Tauri command `get_collaboration_maintenance_owner` 持有。
- 包校验只应验证公开产物和清单契约，私有函数名不属于插件 API。

## 目标行为

1. 删除和导出任务只使用驼峰线协议字段；插件不得输出蛇形数据库字段，桌面端不得接受字段别名。
2. Attempt 投影必须显式包含 `executionRuntime` 和 `canAbandonWithResidualRisk`；字段缺失时拒绝响应，
   不得推断默认值。
3. 墓碑投影必须包含完整的清理和 Flow 核验字段；缺字段、未知字段或蛇形别名均拒绝。
4. Tauri 桌面运行时的维护所有者只由 Rust 安装级持久化文件生成和读取，不从 WebView 存储迁移身份。
5. 协作包校验器只验证 manifest、版本、导出、依赖和产物，不读取编译源码断言私有函数名。
6. Session mutation impact 与 prepare 使用同一 wire 身份投影；数据库内部 `id` 必须映射为 `runId`，并附带
   权威 event watermark，不得把内部字段直接泄露到 Gateway RPC。

## 验收条件

- 旧蛇形任务字段、缺失 Attempt 字段和不完整墓碑的回归测试均失败关闭。
- 插件服务测试证明删除、导出和墓碑输出符合唯一契约。
- Tauri command 无输入参数，返回值不包含迁移专属字段。
- 并发首次创建只能产生一个安装级维护所有者，后续读取稳定复用。
- 协作插件全量测试、前端协作测试、Rust 定向测试和包校验通过。
- Session mutation impact 的插件服务测试与 Desktop coordinator 测试同时验证 `runId`、event watermark 和
  无内部 `id` 泄露。

## 未验证边界

- 尚未通过真实最新版 Gateway 回放协作 RPC。
- 尚未在 macOS、Windows 和 Linux 真机验证安装级所有者文件权限与 WebView 到 Rust 的端到端调用。
