# 标签发布链路验证

## 依据

- `.github/workflows/tag-release.yml` 是当前唯一会创建 GitHub Release 的工作流，触发条件为推送匹配 `v*` 的版本标签。
- 工作流要求标签提交位于 `main` 的祖先链上，标签版本与 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.lock` 四处版本完全一致。
- 发布任务仅在同一提交的 `main` push CI 已成功后创建 Release，防止未经过完整 CI 的制品被发布。

## 当前行为

`v3.0.0` 的安装包构建全部成功，但发布任务失败。失败原因是该提交的 `main` CI 在后续推送时被取消，无法满足“同一提交 CI 成功”的发布门禁。

`.github/workflows/release.yml` 只用于候选构建和证据链验证，不创建 GitHub Release；手动运行它不会代替标签发布。

## 本次目标

1. 将桌面版本提升到 `3.0.1`，并同步 Cargo 锁文件。
2. 先推送版本提交并确认对应 `main` CI 成功。
3. 创建并推送 `v3.0.1`，由 `tag-release.yml` 自动构建 macOS ARM64、macOS x64 与 Windows x64 制品并创建 GitHub Release。

## 验收与边界

- 本地验收：四处版本一致性脚本、标签发布工作流的定向契约测试、`git diff --check`。
- 远端验收：标签工作流的 verify、三平台 build、publish 与 summary 都为成功，并且 GitHub Release 存在且绑定 `v3.0.1`。
- Windows 包仍使用短期内部测试证书，不能表述为公共 CA 信任；macOS、Windows 真实安装验收由目标设备完成。
