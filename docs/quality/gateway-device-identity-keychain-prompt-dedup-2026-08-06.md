# Gateway 设备身份钥匙串提示去重

日期：2026-08-06

## 依据与问题

- `src/services/gateway/GatewayConnectionTargetResolver.ts` 会先调用凭据迁移，再在没有
  device token 时执行一次正常凭据读取。
- `src/services/gateway/credentialProvider.ts` 的两条读取路径都会解析设备身份引用。
- 设备身份私钥由 `src-tauri/src/commands/device_identity.rs` 保存在系统凭据库，并在进程内
  缓存；渲染进程只能取得公开身份引用。

首次运行且没有旧凭据时，迁移路径和外层读取路径可能在同一启动阶段重复发起身份引用 IPC，
macOS 会因此对同一钥匙串条目显示多次授权提示。

## 目标行为

同一渲染进程内并发或连续的设备身份引用查询共享一个单飞 Promise。查询失败时清除该 Promise，
后续用户主动恢复仍可重新访问系统凭据库。挑战签名仍按 OpenClaw 协议逐次生成，不缓存签名
结果，也不改变 Gateway 的拒绝和配对语义。

## 实现与验证

- `src/services/gateway/deviceAuthentication.ts` 统一封装设备身份引用 IPC。
- `src/services/gateway/credentialProvider.ts` 使用该封装，不再直接调用原生 command。
- Rust 端既有 `OnceCell` 继续负责私钥的进程内单次加载；本次改动只去重前端重复调用。
- 已执行 TypeScript 类型检查和定向 Gateway 测试；macOS 钥匙串系统对话框仍需在真实签名包
  中验证。

## 未验证边界

未在当前未签名本地包中重复执行首次安装。正式 Developer ID 签名、公证和钥匙串 ACL 行为仍需
在发布流水线和目标 macOS 环境验收。
