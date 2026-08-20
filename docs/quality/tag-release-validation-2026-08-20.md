# 三点二零标签发布验证

## 发布依据

- 远端最新正式版本为 `v3.1.2`，发布入口为 `.github/workflows/tag-release.yml` 的不可变 `v*` 标签工作流。
- 相对 `v3.1.2`，当前主线新增钉钉业务工作台、智能体工位、Windows 原生语音唤醒和 OpenClaw 官方进度卡投影，并包含 Gateway 生命周期、DWS、消息队列、用量展示和会话安全修复。
- 上述变更包含向后兼容的新能力，版本按语义版本提升为 `3.2.0`，不是在既有 `v3.1.2` 标签上覆盖发布。
- 版本来源必须在 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 中保持一致。

## 发布顺序

1. 完成本地版本一致性、TypeScript、Rust、插件包、生产构建和差异检查。
2. 将版本提交推送到远端 `main`，等待同提交的 `CI` 工作流成功。
3. 创建带注释标签 `v3.2.0` 并推送。
4. 跟踪 `Tagged Desktop Release` 的三平台构建、制品校验和 GitHub Release 创建。
5. 只有工作流、Release 和制品清单均可核验后，才记录线上发布成功。

## 制品与信任边界

- 标签工作流构建 macOS ARM64、macOS x64 和 Windows x64 制品，并生成 Tauri updater 签名与 `latest.json`。
- macOS 当前工作流使用临时签名身份，不代表 Apple Developer ID 签名或公证已经完成。
- Windows 使用工作流临时生成的内部测试证书，不具备公共证书颁发机构信任；Smart App Control 仍可能阻止安装。
- CI 构建成功不能替代 macOS、Windows 和 Linux 目标设备上的安装、升级、权限、凭据库及运行时真机验证。

## 验证结果

### 本地发布前验证

- `pnpm check:versions` 与 `pnpm lint` 通过，四处版本均为 `3.2.0`，模块边界扫描 932 个生产文件，TypeScript 类型检查无错误。
- `pnpm test` 通过：源码测试 2868 项、脚本测试 238 项，无失败。
- `pnpm build` 通过：协作和钉钉插件包重新生成并通过包契约，Vite 转换 9310 个模块；构建后受跟踪的 bundle 与资源无差异。
- `pnpm collab:test` 与 `pnpm collab:validate` 通过：协作插件 355 项测试无失败。
- `pnpm dingtalk:test` 与 `pnpm dingtalk:validate` 通过：钉钉插件 21 项测试无失败。
- `pnpm verify:openclaw-docs` 通过。
- `cargo fmt --all -- --check`、`cargo clippy --all-targets`、`cargo check --all-targets` 和 `cargo test --lib --no-fail-fast` 通过：Rust 653 项通过，1 项按设计忽略；`clippy` 保留既有非阻断警告。
- `git diff --check` 通过。

### 线上结果

远端 `main`、标签工作流、GitHub Release 和制品清单尚未发布，完成后按远端实际结果回写。
