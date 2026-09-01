# 三点三一标签发布验证

日期：2026-09-01

## 修复依据

- `v3.3.0` 主线 CI 的协作插件生产构建无法解析 `openclaw/plugin-sdk/session-transcript-runtime` 的声明文件，因此该标签没有形成正式 Release。
- OpenClaw `v2026.8.1` 官方源码定义并导出该子路径，但正式包清单排除了对应入口声明文件，只保留 JavaScript 入口。
- JunQi 只补充当前调用的官方 `readSessionTranscriptEvents` 与 `appendAssistantMirrorMessageByIdentity` 类型，不复制运行实现，不增加 fallback，也不根据版本号切换能力。
- 原声明含顶层导入，语义是增强一个已具备类型的外部模块，无法覆盖正式包完全缺少声明的情况。修复后声明自身建立正式模块，并在模块内部导入官方 `OpenClawConfig` 类型。
- 内置协作插件同步升级到 `0.5.9`，避免修复后的归档与 `0.5.8` 共用版本身份。

## 版本决策

- 修复不改变用户能力或插件运行协议，采用补丁版本 `3.3.1`。
- `v3.3.0` 保持不可变，不删除、不覆盖、不移动；`v3.3.1` 必须指向包含声明修复与本记录的独立提交。
- `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 必须保持 `3.3.1` 一致。

## 发布门禁

1. 运行协作插件构建，证明补充声明可独立覆盖无入口声明的正式 JavaScript 子路径。
2. 运行完整 lint、测试、OpenClaw 文档链接验证、生产构建和差异检查。
3. 推送修复提交到远端 `main`，等待同一提交的主线 CI 全部通过。
4. 创建并推送不可变标签 `v3.3.1`，跟踪标签源校验、macOS ARM64、macOS x64、Windows x64、制品校验和 Release 创建。
5. 查询 Release 附件清单与 updater 元数据；未取得远端结构化证据前不得描述为正式发布成功。

## 信任与验证边界

- macOS 使用工作流临时签名身份，不代表 Apple Developer ID 签名或公证完成。
- Windows 使用工作流生成的内部测试证书，不具备公共证书颁发机构信任。
- Linux 不在当前标签发布制品范围内。
- 自动化与 Release 成功不能替代目标设备上的安装、升级、权限、凭据库、输入法和真实 Gateway 验收。

## 当前状态

- 发布源提交为 `a5cbe79435d1f37b5ea825903b2eeacd33d13f06`，远端带注释标签 `v3.3.1` 解引用后精确指向该提交。
- 同一提交的主线 CI `33472625972` 已通过，覆盖前端类型检查与生产构建、桌面与协作测试、Rust 格式、Clippy、检查和库测试。
- 标签发布工作流 `33472911707` 已通过，标签源校验、macOS ARM64、macOS x64、Windows x64、制品签名校验、updater 清单生成和 Release 创建均成功。
- GitHub Release `JunQi Desktop 3.3.1` 已于 `2026-09-01T05:42:46Z` 发布，不是草稿或预发布版本：<https://github.com/smartrealm/openclaw-junqi/releases/tag/v3.3.1>。
- Release 共包含 11 个附件：两种 macOS 架构的 DMG、updater 归档及其签名，Windows x64 NSIS 安装器及 updater 签名，Windows 内部测试证书及说明，以及 `latest.json`。
- GitHub 返回的 11 个附件均为 `uploaded` 状态并提供 SHA-256 摘要；发布工作流已根据精确下载制品生成并校验 `latest.json`。
- `v3.3.0` 仍保留为不可变失败标签，没有对应 GitHub Release；没有删除、覆盖或移动该标签。

## 发布制品

- `JunQi.Desktop_3.3.1_aarch64.dmg`
- `JunQi.Desktop_3.3.1_aarch64.app.tar.gz`
- `JunQi.Desktop_3.3.1_aarch64.app.tar.gz.sig`
- `JunQi.Desktop_3.3.1_x64.dmg`
- `JunQi.Desktop_3.3.1_x64.app.tar.gz`
- `JunQi.Desktop_3.3.1_x64.app.tar.gz.sig`
- `JunQi.Desktop_3.3.1_x64-setup.exe`
- `JunQi.Desktop_3.3.1_x64-setup.exe.sig`
- `junqi-internal-test-signing.cer`
- `junqi-internal-test-signing-info.txt`
- `latest.json`

## 发布后边界

- 本次已完成代码、主线 CI、标签工作流和线上 Release 验证。
- 尚未完成 macOS 与 Windows 目标设备上的真实安装、升级、系统信任、权限、凭据库、输入法和 Gateway 端到端验收。
- macOS 与 Windows 的签名信任边界保持本记录前述约束，不得把流水线通过描述为 Apple 公证或公共证书信任。
