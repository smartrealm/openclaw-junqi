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

- 声明修复和版本更新已进入发布前验证，主线提交、远端标签、工作流、Release 与附件结果待发布事务完成后回写。
