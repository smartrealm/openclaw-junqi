# JunQi 隐私锁设计与现状审计

日期：2026-08-05

## 目标

JunQi 隐私锁用于降低离席、共享办公环境和临时借用设备时的肩窥与未授权操作风险。它不是聊天数据库、工作区文件或磁盘数据的密码学加密，也不承诺抵御已经控制操作系统或当前用户会话的攻击者。

锁定期间，Gateway、Agent 和已经启动的后台任务继续运行；所有 JunQi 窗口隐藏敏感投影，Renderer 不得发起新的敏感业务操作，语音输入和输出停止。

## 已核对依据

### 本地实现

- `src-tauri/src/commands/app_settings.rs` 将普通偏好原子写入应用配置目录的 `settings.json`。
- `src-tauri/src/commands/secret_store.rs` 已使用 `keyring 3.6.3` 对接 macOS Keychain、Windows Credential Manager 和 Linux Secret Service，不存在明文文件回退。
- `src/main.tsx` 根据窗口标签分别装载主窗口、萌宠、Quick Chat、灵动岛和独立终端窗口。
- `src-tauri/src/lib.rs` 是插件初始化、Tauri command 注册和窗口生命周期的权威入口。
- `src/services/notifications.ts` 当前可能把通知正文写入持久通知中心并在后台窗口显示系统通知。
- 项目当前没有全局快捷键插件，也没有系统身份验证能力。

### 官方平台契约

- Tauri 2 官方 Global Shortcut 插件支持 Windows、macOS 和 Linux；当前 Rust crate 与前端包的稳定版本均为 `2.3.2`。插件要求显式初始化和 capability 授权。
- Windows 官方 `Windows.Security.Credentials.UI.UserConsentVerifier` 提供能力检查和用户验证，结果区分可用、未配置、策略禁用、忙碌、取消和验证失败。
- macOS 官方 LocalAuthentication `LAContext` 提供 `canEvaluatePolicy` 和 `evaluatePolicy`；`DeviceOwnerAuthentication` 可由系统选择 Touch ID 或系统密码。
- 系统凭据库只负责保存 PIN 验证材料，不等同于 Windows Hello 或 macOS LocalAuthentication。

## 当前缺口

### PL-01：没有 Native 权威锁定状态

当前任何 Renderer 都可以独立装载业务 UI。React 内存、Zustand 或 `localStorage` 都不能防止应用重载或新建辅助窗口绕过锁定。

### PL-02：没有安全的解锁凭据与失败限流

当前没有 PIN 设置、Argon2id 验证、系统凭据库存储、失败次数、退避时间或并发验证门禁。

### PL-03：多窗口会泄漏敏感内容

主窗口、Quick Chat、独立终端、灵动岛和萌宠各自拥有渲染入口。仅在主页面增加遮罩不能保护其他窗口。

### PL-04：锁定期间 IPC 和拖放仍可发起操作

现有文件拖放可以创建 Quick Chat；独立终端和 Quick Chat 可继续操作。只阻止点击不能覆盖快捷键、辅助窗口和直接 invoke。

### PL-05：通知和语音会泄漏内容

持久通知正文、系统通知、语音播报和麦克风采集需要在锁定边界脱敏或停止。

### PL-06：没有全局快捷键、自动离席和恢复锁定

现有 `useKeyboardShortcuts` 仅处理 WebView 内键盘事件。系统空闲、休眠恢复和系统会话锁定没有统一门禁。

### PL-07：没有系统身份验证

Windows Hello 和 macOS 系统认证尚未接入。Linux 缺少统一、可验证的系统身份 API，不能猜测成功。

## 目标架构

### Native 权威状态

Rust 管理唯一 `PrivacyLockState`，包含：

- 是否启用和是否锁定；
- 单调递增 revision；
- 锁定原因；
- 失败次数和基于单调时钟的重试期限；
- 当前快捷键注册结果；
- 系统身份验证能力；
- 自动锁定配置和最近一次可信用户输入时间。

所有窗口只接收过滤后的 `PrivacyLockSnapshot`。快照不包含 PIN、哈希、盐、系统账户、凭据路径或原始认证错误。

### 持久化

`settings.json` 只保存非敏感配置：

- 是否启用；
- 自动锁定秒数；
- 是否在恢复时锁定；
- 是否在启动时锁定；
- 全局快捷键开关和组合。

PIN 使用 Argon2id PHC 字符串保存到系统凭据库。不存在明文文件回退。凭据库失败时启用操作失败关闭。

为了防止崩溃或重载绕过，启用隐私锁后 Native 启动默认进入锁定；成功解锁只影响当前进程会话。关闭应用后再次启动必须重新验证。

### 认证策略

- macOS：优先 LocalAuthentication `DeviceOwnerAuthentication`。
- Windows：优先 `UserConsentVerifier`。
- Linux：系统认证能力明确返回不可用，使用用户主动设置的 Native PIN。
- 所有平台均可配置 Native PIN 作为恢复方式。
- 取消、失败、超时、传感器不可用或策略禁用均保持锁定。

### 多窗口呈现

- 主窗口和独立终端：只渲染统一锁屏壳，不挂载业务页面。
- Quick Chat：只显示锁定状态和“前往主窗口解锁”。
- 灵动岛：只显示静态锁定状态，不显示 Agent、任务、会话或语音状态。
- 萌宠：隐藏内容气泡，禁止拖放和业务动作；仅允许聚焦主窗口。

所有窗口在业务 React 树挂载前读取 Native 快照，因此不会先显示敏感页面再覆盖。

### 操作门禁

锁定状态下，Native 入口必须拒绝创建 Quick Chat、独立终端、文件预览、截图和其他可泄漏窗口。资源拖放被丢弃并清理拖放状态。

Renderer 业务树卸载后不再发起用户操作。后台 Gateway 和 Agent 不被终止。需要长期运行的 Native 任务不依赖解锁状态。

### 自动锁定

Native 轮询平台可信空闲时间：

- Windows：`GetLastInputInfo`；
- macOS：CoreGraphics 最后输入时间；
- Linux：能力探测，不可取得可靠输入时间时明确标记不可用。

应用从休眠或后台恢复时，在窗口重新展示前进入锁定。Windows 和 macOS 的系统会话锁定信号在目标平台接入并验证；无法获得信号时，恢复门禁和空闲检测仍保持失败关闭，不声称已检测系统会话锁定。

### 快捷键

Tauri Global Shortcut 由 Rust 注册。默认值为 `CommandOrControl+Shift+L`。更新采用“先验证并注册新组合，再注销旧组合，再持久化”的事务顺序；注册失败保留旧快捷键和旧配置。

### 通知和语音

锁定时：

- 新通知只保存脱敏标题和空正文；
- 不播放提示音，不显示包含正文的系统通知；
- 停止本地 TTS、音频播放和麦克风采集；
- 灵动岛和萌宠不投影任务详情。

解锁不会补播锁定期间的敏感正文。

## 威胁模型边界

该功能防护：

- 离席后他人浏览 JunQi 窗口；
- 通过辅助窗口、快捷键或拖放继续操作；
- 通知、语音和灵动岛泄漏当前内容；
- Renderer 重载、新窗口或应用重启绕过锁定。

该功能不防护：

- 已取得当前操作系统账户或管理员权限的攻击者；
- 系统级录屏、键盘记录、内存读取或调试注入；
- OpenClaw、工作区和外部服务自身保存的数据；
- 锁定前已经由其他应用复制、缓存或显示的内容。

## 验证边界

自动化可以验证状态机、IPC 字段、凭据不落盘、多窗口条件渲染、快捷键事务、通知脱敏和恢复门禁。Windows Hello、Windows 会话锁定、macOS Touch ID、睡眠恢复、Linux 桌面会话、全局快捷键冲突和多显示器行为必须在对应真机验证。
