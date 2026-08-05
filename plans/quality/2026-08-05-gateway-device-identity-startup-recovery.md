# Gateway 设备身份与工作区启动恢复计划

## 实施顺序

1. [x] 核对设备签名 command、系统凭据库读写、Gateway challenge 与 App 首屏门禁调用链。
2. [x] 为成功设备身份增加进程内单次初始化缓存，失败不缓存。
3. [x] 将连接重试耗尽纳入已完成安装的工作区放行条件。
4. [x] 补充 Rust 与前端回归测试，验证缓存和首屏门禁。
5. [ ] 在真实系统凭据库与 Gateway 环境完成 macOS、Windows、CentOS/Ubuntu 桌面验收。

## 文件范围

- `src-tauri/src/commands/device_identity.rs`
- `src/runtime/workspaceBootstrapReadiness.ts`
- `src/runtime/workspaceBootstrapReadiness.test.ts`
- `src/App.tsx`
- 对应 docs、specs、plans 索引与本记录

## 非目标

- 不修改 OpenClaw Gateway 的挑战协议、设备配对、token 轮换或日常 scope。
- 不增加凭据的文件 fallback、浏览器实现或平台专属假设。
