# Gateway 设备身份与工作区启动恢复

日期：2026-08-05

## 依据与范围

- `src-tauri/src/commands/device_identity.rs` 使用系统凭据库保存 OpenClaw Gateway
  设备身份的 PKCS#8 私钥；私钥不会跨 Tauri IPC 返回给渲染进程。
- `src/services/gateway/Connection.ts` 仅在收到 Gateway `connect.challenge` 后请求原生
  签名，并在签名不可用时关闭当前握手，不发送无设备签名的 `connect` 请求。
- `src/App.tsx` 的工作区首屏在权威会话快照可用前保留启动遮罩；该遮罩必须在连接终态
  失败时释放，以便用户看到并使用既有的 Gateway 恢复界面。

本次不改变 OpenClaw 的挑战、配对、token 或 scope 协议。

## 问题

每次 Gateway `connect.challenge` 都会调用原生签名 command。原实现每次签名都重新读取
macOS Keychain、Windows Credential Manager 或 Linux Secret Service。系统凭据库要求交互
授权时，自动重连和并发身份查询会产生重复系统授权请求。

同时，首屏只会在会话读取失败时放行。设备签名无法完成导致连接重试耗尽时，应用没有
进入会话读取路径，因而一直显示“正在同步工作区”。

## 目标行为

1. 设备身份第一次成功从系统凭据库读取或创建后，只在当前进程内复用同一私钥对象。
   不创建明文文件、不向前端暴露私钥，也不跨应用启动持有缓存。
2. 初始化失败不缓存。用户拒绝系统授权、凭据库暂不可用或私钥损坏时，下一次由用户
   主动触发的恢复仍可重新请求系统凭据库。
3. Gateway 仍必须提供合法挑战，且没有签名时仍按既有 fail-closed 路径关闭握手。
4. 已完成安装验证的工作区，在 Gateway 自动重试耗尽后解除启动遮罩并保留真实离线状态；
   安装验证尚未完成时不提前进入工作区。

## 实现

- `DeviceIdentityCache` 使用 `tokio::sync::OnceCell` 只接受成功初始化结果，串行化同一
  进程内的首个系统凭据库读取或创建操作。
- `shouldReleaseWorkspaceAfterGatewayRetryExhaustion` 明确安装完成与缓存安装验证的门禁。
  `App` 收到连接重试 `exhausted` 后，将 connection 启动阶段标记为错误并通过既有的
  不完整快照放行路径显示可恢复工作区。

## 验证

- `workspaceBootstrapReadiness.test.ts` 覆盖未完成安装、安装验证未完成和可放行三种
  重试穷尽条件。
- Rust 回归测试验证成功初始化仅执行一次，第二次调用复用同一公钥而不会再次调用初始化器。
- 仍需在 macOS Keychain、Windows Credential Manager、CentOS/Ubuntu Secret Service 上以
  真实 Desktop 包和实际 Gateway 验证授权提示及恢复界面。自动化测试无法验证系统授权
  对话框的“始终允许”设置。
