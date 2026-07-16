# Windows/macOS 运行时聚合审计

日期：2026-07-16

## 审计范围

覆盖 Node.js/Git 的平台能力、国内源目录、版本选择、归档映射、下载校验、解压激活、
运行时探测、迁移配置和设置页更新入口。Windows 与 macOS 共用策略必须只有一个所有者，
平台差异只允许保留在归档格式和 Git 能力边界。

## 严重问题

### BUG-RP-01 · CRITICAL — 更新成功但活动运行时没有变化

**位置**：`src-tauri/src/commands/managed_runtime.rs:31`、
`src-tauri/src/commands/setup.rs:891`、`src-tauri/src/commands/system.rs:337`

**问题**：设置页在系统 Node/Git 已可用时仍允许执行托管更新。强制更新会把新副本安装到
JunQi 默认目录，但探测逻辑继续优先返回系统工具，因此 UI 显示成功，OpenClaw 实际仍使用
原来的系统版本。Node 在 Windows/macOS 均受影响，Git 在 Windows 受影响。

**影响**：

- 用户看到下载、校验和安装成功，却没有更新当前活动工具。
- 多出几十 MB 未使用运行时，后续状态仍显示旧版本。

**修复方案**：只有活动来源是 JunQi 托管/自定义目录，或当前工具不可用时，才暴露托管更新；
系统工具可用时明确显示由系统管理，不执行无效下载。

## 中等问题

### BUG-RP-02 · MEDIUM — 平台制品映射存在两个所有者

**位置**：`src-tauri/src/commands/node_runtime.rs:31`、
`src-tauri/src/commands/setup.rs:188`

**问题**：Node 索引使用的 `osx-arm64-tar`/`win-x64-zip` 与实际下载文件名分别由两个函数
拼装。增加平台、架构或修改格式时可能只改一处，导致版本能选中但归档无法下载。

**修复方案**：建立单一 `ManagedNodePlatform` 模型，同时产生索引制品键、归档文件名、
归档格式和解压后的顶层目录。

### BUG-RP-03 · MEDIUM — 实际源目录与 UI 下载顺序重复维护

**位置**：`src-tauri/src/commands/setup.rs:26`、
`src-tauri/src/commands/managed_runtime.rs:34`、
`src-tauri/src/commands/git_runtime.rs:22`

**问题**：安装器维护 URL 与日志标签，状态接口又单独维护显示名称。源增删或排序变化时，
UI 可能展示与真实回退链不同的顺序。

**修复方案**：Node/Git 各自维护一个结构化源目录，下载 URL、日志标签和 UI 顺序均从目录派生。

### BUG-RP-04 · MEDIUM — `local` 混淆自定义目录与默认托管目录

**位置**：`src-tauri/src/commands/system.rs:353`、
`src/components/settings/ManagedRuntimeSettingsPanel.tsx:151`

**问题**：显式选择目录和 JunQi 默认托管目录都返回 `local`。设置页已有“JunQi 托管”翻译，
但永远不会使用，也无法据此判断更新操作的真实目标。

**修复方案**：使用明确的 `system`、`managed`、`custom` 来源枚举，并由前后端穷举处理。

### BUG-RP-05 · MEDIUM — 平台能力在多个模块重复表达

**位置**：`src-tauri/src/commands/storage.rs:1110`、
`src-tauri/src/commands/managed_runtime.rs:31`、
`src-tauri/src/commands/setup.rs:907`

**问题**：Windows/macOS 是否支持托管 Node、是否支持托管 Git 分散为多处 `cfg!`/`#[cfg]`。
新增平台能力时容易出现 UI 可选、状态可更新、安装器不可执行的组合。

**修复方案**：集中提供平台能力模型；条件编译只负责排除平台专用实现，产品能力判断统一读取模型。

## 已验证正确的边界

- Node 版本由 OpenClaw `engines.node` 和国内镜像索引动态选择，没有固定具体版本。
- Node 索引、校验文件和归档当前使用同一源优先级。
- Windows/macOS Node 归档均校验发布方 SHA-256 后才解压。
- Git 具体制品与摘要已移出 Rust 业务代码，保存在独立受审清单。
- macOS 不接受托管 Git，继续由系统或 Apple Command Line Tools 管理。

## 修复结果

- BUG-RP-01：已修复。可用系统工具不再提供托管更新，后端直接调用也会拒绝。
- BUG-RP-02：已修复。`ManagedNodePlatform` 统一生成索引键、归档名、格式和解压目录。
- BUG-RP-03：已修复。Node/Git 下载 URL、日志标签和 UI 顺序分别由唯一源目录生成。
- BUG-RP-04：已修复。来源统一为 `system`、`managed`、`custom` 类型化枚举。
- BUG-RP-05：已修复。能力模型直接复用 Node 制品模型并校验 Git 平台与架构。

## 验证记录

- Rust 全量测试：335 通过，2 忽略，0 失败。
- 审计专用回归：6 通过，0 失败。
- 前端与脚本：817 通过，0 失败。
- TypeScript、Rust 格式、旧符号清理、差异检查和生产构建：全部通过。
