# JunQi 隐私锁实施计划

日期：2026-08-05

## 阶段一：Native 权威状态和凭据

- [x] 在 `app_settings.rs` 增加非敏感隐私锁配置并兼容旧 settings 文件。
- [x] 新增 Rust 隐私锁状态机、revision、锁定原因、失败退避和事件快照。
- [x] 使用 Argon2id、随机盐、zeroize 和现有系统凭据库实现 PIN 设置、修改、验证和关闭。
- [x] 注册最小 Tauri command，并增加序列化和状态机测试。

## 阶段二：冷启动门禁和多窗口锁屏

- [ ] 在 Tauri 创建窗口前初始化锁定状态，启用后冷启动默认锁定。
- [ ] 新增共享 `PrivacyLockGate` 和锁屏 UI，在主窗口、Quick Chat、独立终端、灵动岛和萌宠业务树之前挂载。
- [ ] 锁定时卸载敏感业务树并阻止拖放、新建辅助窗口、文件预览和截图入口。
- [ ] 增加多窗口和重载不可绕过回归测试。

## 阶段三：设置闭环和本地 PIN

- [x] 设置页新增“安全与隐私”标签。
- [x] 实现启用、设置 PIN、修改 PIN、关闭、立即锁定和恢复说明。
- [x] 实现自动锁定时间、启动锁定、恢复锁定和快捷键配置 UI。
- [x] 完成简体中文、繁体中文和英文文案及可访问性测试。

## 阶段四：全局快捷键和托盘

- [ ] 精确锁定 Tauri Global Shortcut `2.3.2` Rust 与前端依赖并初始化插件。
- [ ] 实现默认快捷键、事务式修改、冲突错误、禁用和恢复默认。
- [ ] 托盘菜单增加立即锁定入口并覆盖现有语言。
- [ ] 验证退出注销和多实例行为。

## 阶段五：通知、语音和业务操作门禁

- [ ] 锁定时通知持久化和系统展示脱敏，提示音停止。
- [ ] 锁定事件停止麦克风采集、本地 TTS 和音频输出。
- [ ] Quick Chat、独立终端、Provider、OAuth、设备审批、文件和截图操作增加 Native 锁定门禁。
- [ ] 保留 Gateway、Agent 和既有后台任务运行。

## 阶段六：自动离席、休眠和会话锁定

- [x] Windows 使用 `GetLastInputInfo`，macOS 使用 CoreGraphics 读取系统空闲时间。
- [x] Linux 提供能力探测；无可靠系统 API 时显示不可用，不使用 Renderer 猜测。
- [x] Tauri 恢复事件在窗口展示前锁定。
- [x] 修复解锁后系统空闲计时未归零导致的立即重复锁定：必须先观察到一次真实系统活动。
- [ ] 接入并验证 Windows 和 macOS 可取得的系统会话锁定信号。

## 阶段七：系统身份验证

- [ ] macOS 接入 LocalAuthentication `DeviceOwnerAuthentication`，过滤错误分类。
- [ ] Windows 接入 `UserConsentVerifier`，过滤能力与验证结果。
- [ ] 设置和锁屏根据实时能力显示系统认证按钮。
- [ ] 取消、失败、忙碌、超时和策略禁用保持锁定，并允许用户改用 Native PIN。

## 阶段八：验证与记录

- [ ] 运行定向前端和 Rust 测试。
- [ ] 运行完整 lint、test、build、Rust fmt/check/test、Emoji 扫描和 `git diff --check`。
- [ ] 在本机 macOS 验证 Keychain、系统认证、快捷键、休眠恢复、四主题、键盘和窄窗口。
- [ ] 将 Windows Hello、会话锁定、Credential Manager、125%/150% 缩放和快捷键冲突标记为 Windows 真机验收项。
- [ ] 更新 docs/specs/plans 索引和最终 validation 记录。
