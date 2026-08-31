# 三点二二标签发布验证

日期：2026-08-31

## 发布依据

- 远端最新正式标签为 `v3.2.1`，发布入口是 `.github/workflows/tag-release.yml` 的不可变 `v*` 标签工作流。
- `v3.2.1` 之后的已提交变更修复了 OpenClaw 会话计划兼容、目标运行时安装、协作插件更新与 schema 迁移、Gateway 重启门禁、桌面窗口恢复、DWS 授权取消、会话输入和消息操作层级。
- 这些变更保持现有产品范围，没有引入新的企业控制面或与 OpenClaw 平行的运行时语义，因此采用补丁版本 `3.2.2`，不覆盖既有标签或 Release。
- 版本来源必须在 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 中保持一致。

## 发布顺序

1. 提交四处版本更新和本验证记录。
2. 将精确发布源提交推送到远端 `main`。
3. 等待该提交触发的 `CI` 工作流成功，不能用其他提交或本地执行结果替代。
4. 创建并推送带注释标签 `v3.2.2`。
5. 跟踪 `Tagged Desktop Release` 的源校验、三平台构建、制品校验和 GitHub Release 创建。
6. 只有工作流、Release 和制品清单均取得结构化线上证据后，才记录发布成功。

## 制品与信任边界

- 标签工作流构建 macOS ARM64、macOS x64 和 Windows x64 制品，并生成 Tauri updater 签名与 `latest.json`。
- macOS 工作流使用临时签名身份，不代表 Apple Developer ID 签名或公证完成。
- Windows 使用工作流临时生成的内部测试证书，不具备公共证书颁发机构信任；Smart App Control 仍可能阻止安装。
- CI 和 Release 成功不能替代目标设备上的安装、升级、权限、凭据库及运行时真机验证；Linux 不在当前标签工作流的制品范围内。

## 当前状态

- 发布源版本已更新为 `3.2.2`，远端主线 CI、标签工作流、Release 和制品仍待执行与核验。
- 工作区中与本次发布无关的未提交 Gateway 审计改动和未跟踪目录不会进入发布提交。
