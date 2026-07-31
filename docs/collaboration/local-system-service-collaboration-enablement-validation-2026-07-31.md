# 本机 System Service 协作启用归属修复验证

日期：2026-07-31

## 依据

- 仓库协作设计规定：JunQi 明确拥有且可持续运行的 `SYSTEM_SERVICE` / persistent `DOCKER` 由 Desktop 自动安装固定插件；`EXTERNAL` 只使用已健康插件或展示手工说明。
- Gateway 归属审计规定：健康端点不是 service 身份证明；selected state/config、官方 service metadata 和 owner 必须独立核验，歧义时 fail closed。
- 项目安装的 OpenClaw `2026.7.1` 是本次 service status JSON 解析与身份字段的版本基线；实现继续复用现有 `gateway status --json --no-probe` inspection，不新增或猜测上游字段。

本机只读证据显示：

- Gateway 监听 `127.0.0.1:18789`；
- 官方 launchd service 正在运行；
- service 的 `OPENCLAW_STATE_DIR` 为 `/Users/wei/.openclaw`；
- service 的 `OPENCLAW_CONFIG_PATH` 为 `/Users/wei/.openclaw/openclaw.json`；
- JunQi `bootstrap.json` 选择相同 state/config，runtime 为 Native。

因此当前 UI 的“将包交给 Gateway 管理员”不是目标产品行为，而是启动时 owner 恢复缺失导致的 `External` 误分类。

## 修改

- `gateway_service.rs`：新增选定 Native service 的只读 inspection 入口，以及 running-selected-service 谓词；该谓词复用现有 `belongs_to_selected_state` 契约，允许精确匹配以及可由官方 handoff 重建的 stale runtime/locale，拒绝 Foreign、Unverifiable 和 Absent。
- `ensure.rs`：健康端点快速路径在 owner 缺失时重新核验官方 service，精确匹配才恢复 `SystemService`。
- `gateway.rs`：普通 start 的健康端点复用路径使用同一恢复逻辑。
- External、Foreign、Unverifiable 和检查失败继续 fail closed；collaboration bootstrap 写入边界未放宽。

## 验证结果

- 协作 setup 定向测试：16/16 通过。
- 新增 service identity 定向 Rust 测试：通过；既有 BUG-GSO-08 回归继续覆盖 Managed Child owner 优先级。
- `pnpm lint`：通过，模块边界检查 666 个文件，TypeScript `tsc --noEmit` 通过。
- `pnpm test`：前端 2003/2003、脚本 224/224 通过。
- `cargo fmt -- --check`：通过。
- `cargo check --lib`：通过。
- `cargo test --lib`：665 passed、3 ignored、0 failed。
- `git diff --check`：通过。

## 未验证边界

- 当前自动化不能证明 app 重启后的真实 Tauri 握手与对话框视觉结果。
- 没有新增或修改 Tauri command、IPC 参数及 serde wire 字段；因此本次未产生新的前后端 IPC 合同。
- 尚未在 Windows Scheduled Task 或 Linux systemd 真机验证。
- 未执行插件安装、Gateway 重启或打包。
