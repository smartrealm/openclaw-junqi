# 三点三零标签发布验证

日期：2026-09-01

## 发布依据

- 远端最新正式标签为 `v3.2.2`，发布入口是 `.github/workflows/tag-release.yml` 的不可变 `v*` 标签工作流。
- 本次变更将内置协作与钉钉插件的编译基线对齐 OpenClaw `2026.8.1`，并新增正式结构化问题、密钥输入与主连接最小权限交互。
- 首次设置和活动审计删除了被替代的旧协议路径，不保留旧版本兼容分支或推断性 fallback。
- 这些内容新增用户可见能力并更新插件契约，因此采用次版本 `3.3.0`，不覆盖既有标签或 Release。
- 版本来源必须在 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 中保持一致。

## 发布顺序

1. 完成本次源码、固定插件包、版本元数据和发布验证记录的自动化检查。
2. 将精确发布源提交推送到远端 `main`。
3. 创建并推送准确指向发布源提交的带注释标签 `v3.3.0`，由标签推送触发 `Tagged Desktop Release`。
4. 核对同一提交的主线 CI 与标签工作流，不用其他提交或本地结果替代线上验证。
5. 跟踪源校验、macOS ARM64、macOS x64、Windows x64、制品校验及 GitHub Release 创建。
6. 只有线上工作流、Release 和附件清单均取得结构化证据后，才能记录正式发布成功。

## 制品与信任边界

- 标签工作流构建 macOS ARM64、macOS x64 和 Windows x64 制品，并生成 Tauri updater 签名与 `latest.json`。
- macOS 工作流使用临时签名身份，不代表 Apple Developer ID 签名或公证完成。
- Windows 使用工作流临时生成的内部测试证书，不具备公共证书颁发机构信任。
- Linux 不在当前标签工作流的发布制品范围内。
- CI 与 Release 成功不能替代目标设备上的安装、升级、权限、凭据库、输入法和真实 Gateway 验收。

## 发布前验证

- OpenClaw `v2026.8.1` 官方 tag、正式协议和结构化问题交互已核对。
- `pnpm test` 已通过，前端测试 2968 项、脚本测试 238 项。
- 协作插件测试 369 项通过。
- `pnpm lint`、`pnpm build`、`pnpm verify:openclaw-docs` 和 `git diff --check` 已通过。
- 修改后的文本文件未检出 Emoji；新增执行代码未写入 OpenClaw 版本字面量或开发机绝对路径。

## 当前状态

- 发布前自动化验证已完成；发布源提交、远端 tag、工作流和 Release 结果将在发布事务完成后依据远端证据记录。
- 正式状态必须以后续远端 tag、工作流、Release 和附件查询结果为准。
