# 三点二一标签发布验证

## 发布依据

- 远端最新正式版本为 `v3.2.0`，发布入口为 `.github/workflows/tag-release.yml` 的不可变 `v*` 标签工作流。
- `v3.2.0` 发布后，主线仅新增已核验发布结果的交接记录，没有新增运行时代码或改变 OpenClaw、DWS、Gateway、会话、工具和渠道语义。
- 用户明确要求提交当前主线并发布新 Release，因此采用补丁版本 `3.2.1`，不覆盖既有 `v3.2.0` 标签或 Release。
- 版本来源必须在 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 中保持一致。

## 发布顺序

1. 完成本地版本一致性、TypeScript、Rust、插件包、生产构建和差异检查。
2. 将版本提交推送到远端 `main`，等待同提交的 `CI` 工作流成功。
3. 创建带注释标签 `v3.2.1` 并推送。
4. 跟踪 `Tagged Desktop Release` 的三平台构建、制品校验和 GitHub Release 创建。
5. 只有工作流、Release 和制品清单均可核验后，才记录线上发布成功。

## 制品与信任边界

- 标签工作流构建 macOS ARM64、macOS x64 和 Windows x64 制品，并生成 Tauri updater 签名与 `latest.json`。
- macOS 当前工作流使用临时签名身份，不代表 Apple Developer ID 签名或公证已经完成。
- Windows 使用工作流临时生成的内部测试证书，不具备公共证书颁发机构信任；Smart App Control 仍可能阻止安装。
- CI 构建成功不能替代目标设备上的安装、升级、权限、凭据库及运行时真机验证；Linux 不在当前标签工作流的制品范围内。

## 验证结果

### 本地发布前验证

- `pnpm check:versions` 与 `pnpm lint` 通过，四处版本均为 `3.2.1`，模块边界扫描 932 个生产文件，TypeScript 类型检查无错误。
- `pnpm test` 通过：源码测试 2868 项、脚本测试 238 项，无失败。
- `pnpm build` 通过：协作和钉钉插件包重新生成并通过包契约，Vite 转换 9310 个模块；构建后受跟踪的 bundle 与资源无差异。
- `pnpm collab:test` 与 `pnpm collab:validate` 通过：协作插件 355 项测试无失败。
- `pnpm dingtalk:test` 与 `pnpm dingtalk:validate` 通过：钉钉插件 21 项测试无失败。
- `pnpm verify:openclaw-docs` 通过。
- `cargo fmt --all -- --check`、`cargo clippy --all-targets`、`cargo check --all-targets` 和 `cargo test --lib --no-fail-fast` 通过：Rust 653 项通过，1 项按设计忽略；`clippy` 保留既有非阻断警告。
- `git diff --check`、修改后完整文件 Emoji 扫描和暂存内容敏感信息扫描通过。

### 线上结果

- 版本提交 `5df92992c04e9420efe365b06c98e0c33acfde96` 已推送到远端 `main`；远端记录本次直接推送使用了具备权限的规则绕过，同提交 `CI` 工作流 [32322901090](https://github.com/smartrealm/openclaw-junqi/actions/runs/32322901090) 随后全部成功。
- 带注释标签 `v3.2.1` 已推送。远端标签对象为 `2d910703663a59ae58ad1a00ed1ecba786e644a6`，独立验证脚本解引用后确认其精确指向版本提交 `5df92992c04e9420efe365b06c98e0c33acfde96`。
- `Tagged Desktop Release` 工作流 [32323466560](https://github.com/smartrealm/openclaw-junqi/actions/runs/32323466560) 全部成功；发布源校验、macOS ARM64、macOS x64、Windows x64、Release 创建和汇总均为成功终态。
- [JunQi Desktop 3.2.1](https://github.com/smartrealm/openclaw-junqi/releases/tag/v3.2.1) 已于 2026-08-20 发布并成为 Latest，不是草稿或预发布版本。
- Release 共包含 11 个附件：macOS ARM64 与 x64 的 DMG、应用更新包及签名，Windows x64 安装程序及更新签名，内部测试证书与说明，以及 `latest.json`。GitHub 已为全部附件返回 SHA-256 摘要。
- 本次线上验证证明不可变标签、三平台 CI 构建、附件上传和更新清单生成成功；不证明 macOS Developer ID 签名、公证、Windows 公共证书信任或目标设备安装运行已经通过。
