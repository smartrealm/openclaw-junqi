# 协作插件更新 Peer Link 修复计划

日期：2026-08-14

## 实施顺序

### 阶段一：BUG-01 更新预检恢复

1. 在 `collaboration_bootstrap.rs` 增加合法 OpenClaw host peer link 的严格判定。
2. 让插件树归档和内容哈希共用同一排除规则。
3. 增加合法链接、无声明链接和其他链接的回归测试。

### 阶段二：BUG-02 版本身份收敛

1. 将协作插件版本提升至 0.5.0。
2. 更新 README 命令与当前 schema 基线。
3. 重新生成协作插件归档、Rust 资源 metadata 和前端 metadata。

### 阶段三：验证

1. 运行协作插件测试与包验证。
2. 运行 Rust 定向测试、格式检查、静态检查和完整库测试。
3. 运行前端 lint、测试、生产构建和 OpenClaw 文档链接验证。
4. 执行 Emoji 扫描、`git diff --check` 并回写 `PROJECT_STATUS.md`。

## 执行结果

- 阶段一已完成：只排除有正式 peer 声明的精确 `node_modules/openclaw` 链接，其他符号链接或 Windows 重解析点继续失败关闭。
- 阶段二已完成：协作插件、清单、运行时常量、README、归档和 metadata 已统一为 0.5.0、schema 15。
- 阶段三自动化已完成；真实 Gateway 更新重启和 Windows、Linux、Docker 真机验证仍未执行。
