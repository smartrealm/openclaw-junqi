# 标签发布链路验证

## 依据

- `.github/workflows/tag-release.yml` 是当前版本标签发布入口，触发条件为推送匹配 `v*` 的标签。
- 工作流要求标签提交位于远端 `main` 的祖先链上，标签版本与 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.lock` 四处版本完全一致。
- 发布任务只接受同一提交的 `main` push CI 成功结果，随后构建 macOS ARM64、macOS x64 与 Windows x64 制品并创建 GitHub Release。
- Windows 制品使用短期内部测试证书，不具备公共证书颁发机构信任；macOS 制品使用 Tauri updater 签名，但本地验证不等同于公证和目标设备验收。

## 当前变更

相对 `v3.0.1`，当前主线新增或完善了安装向导长选项搜索、渠道扫码生命周期、OpenClaw 运行时语言对齐和聊天原生交互，因此按向后兼容的新能力提升为 `3.1.0`。

桌面版本已同步到以下四个来源：

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`

## 发布顺序

1. 执行版本一致性、完整前端测试、Rust 测试和生产构建。
2. 提交 `3.1.0` 版本变更并推送 `main`。
3. 创建带注释标签 `v3.1.0` 并推送标签。
4. 核对 `CI` 与 `Tagged Desktop Release` 均绑定同一提交。
5. 只有远端工作流和 GitHub Release 均成功后，才能声明正式发布完成。

## 验收边界

- 本地验证只证明源码、契约和当前 macOS 构建环境通过，不证明 Windows 安装、macOS 公证或线上 Release 成功。
- 标签推送后必须继续核对远端工作流；工作流仍在运行时只能表述为已触发。
- 发布前完整测试发现安装进度和颜色预算守护仍绑定旧实现数量；现已改为渲染运行与失败状态并核对语义主题色，同时删除已归零的颜色预算条目。
