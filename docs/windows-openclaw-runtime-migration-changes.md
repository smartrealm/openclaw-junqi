# Windows OpenClaw 运行时迁移变更说明

- **发布版本**：v1.2.1
- **发布分支**：daxia
- **版本性质**：v1.2.0 的 Windows 迁移与运行时可靠性补丁

## 目标

Windows 用户迁移 OpenClaw 数据时，可以独立重新选择 Node.js、Git、npm 缓存和 OpenClaw npm 安装目录。迁移过程中不得继续使用旧二进制，也不能因为应用退出、安装失败或并发配置而错误提交完成状态。

## 用户可见变化

- 迁移现有数据时，工作区和内部运行时保持原有相对布局；Node.js、Git、npm 缓存和 npm prefix 可以分别调整。
- 自定义 Node.js 目录使用便携运行时；关闭自定义后使用 Windows 系统 Node.js。
- 自定义 Git 目录使用便携 Git；关闭自定义后使用 Windows PATH 中的系统 Git。
- npm 缓存仅影响后续 npm 下载，不修改用户 npmrc。
- npm prefix 变化会触发 OpenClaw 在新位置重新安装和物理路径校验。
- 安装日志和进度继续通过现有 setup progress 事件显示。

## 迁移流程

1. 校验所有目录均为绝对路径，且工作区、运行时、缓存、prefix、Node.js 和 Git 目录互不包含。
2. 保存新路径前停止旧 Gateway，并确认目标端口已经释放。
3. 按 `Git -> Node.js -> npm -> OpenClaw` 顺序检查或安装依赖。
4. npm prefix 变化时持久化待迁移状态，禁止 Gateway、更新、修复和终端集成回退到旧 OpenClaw。
5. 使用国内 npm 源优先策略将 OpenClaw 强制安装到目标 prefix。
6. 校验 OpenClaw 包、CLI 版本、可执行文件和实际 npm prefix。
7. 使用已验证的新二进制更新终端启动器，保存二进制选择，最后清除待迁移状态。

## 健壮性与扩展性

- 存储迁移和 OpenClaw 安装共用 Gateway 全局操作锁，避免两个事务并发覆盖 bootstrap。
- 完成迁移时校验安装开始时的 npm prefix 仍是当前选择；配置已经变化则保留待迁移状态并要求重试。
- 便携 Node.js 必须同时具备兼容的 `node.exe` 和配套 `npm-cli.js`，缺少 npm 时自动重新部署完整运行时。
- Windows 路径等价、可选路径比较和目录重叠由 `paths` 模块统一处理，覆盖大小写、分隔符、符号链接和尚未创建的末级目录。
- `OpenclawRelocationRequest` 统一封装 `目标校验 -> 终端同步 -> 二进制持久化 -> 状态提交`，新增安装入口时复用同一事务边界。
- 待迁移状态写入 storage bootstrap，应用退出后可以继续执行，不依赖前端内存状态。

## 失败恢复

- Gateway 无法停止或端口未释放：不保存新路径；原先可达的 Gateway 尝试按旧配置恢复。
- Node.js、Git 或 OpenClaw 下载失败：保留当前迁移状态，用户可重新执行安装。
- OpenClaw 安装位置与目标 prefix 不一致：拒绝提交并保留待迁移状态。
- 终端启动器或用户 PATH 更新失败：不清除待迁移状态。
- 安装期间 npm prefix 被再次修改：旧安装不能清除新配置的待迁移状态。

## 不包含的行为

- 不自动删除旧 Node.js、Git、OpenClaw 或 npm 缓存目录。
- 不修改用户或系统 npmrc。
- 不把 JunQi 的便携 Node.js、Git 强制写入系统 PATH。
- 不在 macOS 主机生成或冒充 Windows 签名安装包；Windows 安装包由 GitHub Actions 原生 Windows runner 构建和签名。

## 验证

- Rust：330 passed，0 failed，2 ignored。
- 前端：791 passed；脚本与边界测试 23 passed。
- TypeScript 与 Vite 生产构建通过。
- Tauri macOS app/DMG 本地打包验证。
- Windows x64/ARM64 安装包由 `Release Build` 工作流使用 `daxia` ref 在线构建。
