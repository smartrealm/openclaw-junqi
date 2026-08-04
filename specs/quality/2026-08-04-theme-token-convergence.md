# 主题 Token 收敛规格

日期：2026-08-04

## 问题

产品页面仍存在散落的固定颜色、固定阴影和主题名分支。它们会使一键换肤出现局部不变、终端 canvas 保留旧色或弹层仍使用暗色阴影。

## 目标

1. 产品 chrome 的颜色、阴影和遮罩使用 Aegis 语义 token。
2. 每个具体主题都定义共享 chrome token，不能依赖组件 fallback 才能渲染。
3. xterm 创建和主题更新都读取当前文档主题，主题切换不重建 PTY。
4. 内容资产色不被误认为产品 chrome；例外必须有文件级审查预算或注释。

## 约束

- 不改变 OpenClaw、Tauri IPC 或终端 PTY 生命周期契约。
- 不把 secret、运行时配置或用户数据写入主题变量。
- 不通过清空颜色或透明化方式掩盖缺失 token。
- 主题切换只改变视觉变量，不改变页面状态、会话或终端滚动内容。

## 验收条件

- 四个具体主题均存在 `shadow-card`、`shadow-float`、`shadow-popover`、`scrim`、`pet-text` 和完整 `status` token。
- 工作台、终端页面和 xterm 搜索没有产品 chrome 的固定白色、黑色或状态 hex。
- 主题切换后已挂载的 xterm 实例刷新颜色且保留滚动内容。
- 主题桥和 hex 审查测试通过。
