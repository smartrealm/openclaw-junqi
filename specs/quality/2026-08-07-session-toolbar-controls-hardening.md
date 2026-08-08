# 会话工具栏控件加固规格

## 上游依据

- OpenClaw Control UI：`sessions.files.list/get` 与 `sessions.diff` 是 Gateway 会话工作区的权威读取投影；`sessions.files.set` 的写入和具体方法 scope 以当前 Gateway 的正式协议为准。
- JunQi 只呈现 Gateway 返回的会话内容，不通过本机路径、浏览器状态或本地 Git 结果补足未知状态。

## 当前问题

1. 会话上下文栏的图标按钮混用原生 `title` 与共享 Tooltip，悬浮提示不稳定。
2. 低频的分支、检查点、产物、变更和文件入口占用同一排常驻空间。
3. `sessions.diff` 授权失败时只显示 Gateway 原始错误，用户无法区分权限不足与方法不支持。
4. 会话文件选中后没有可安全预览内容时，界面只显示一条笼统提示。
5. 当前 Gateway 未提供会话旁问方法，桌面端不能继续展示稳定失败的入口。

## 目标行为

- 所有会话上下文栏的图标按钮复用 `ChatIconButton`，同时保留可访问名称和原生 title 兜底。
- 保留已由当前 Gateway 验证的 OpenClaw 原生会话能力，并将低频会话视图收进“会话工具”入口。
- `sessions.diff` 使用已有的一次性 `operator.admin` Gateway 连接尝试，显示 Gateway 的缺失 scope 和下一步；不在普通连接上伪造权限，也不绕过 Gateway。
- 会话文件预览失败按文件缺失、类型不支持、Gateway 未返回内容和未知原因区分，并展示 Gateway 返回的安全元数据。
- 移除当前 Gateway 不支持的会话旁问入口、专属 RPC 客户端和本地 `/btw`/`/side` 拦截；不使用本地 fallback。

## 验收条件

- 图标按钮在鼠标悬停和键盘聚焦时均显示本地化提示，且保留 `aria-label`。
- 顶部工具栏不再直接展开所有低频会话视图入口。
- `sessions.diff` 的未授权响应不被当作空差异、方法不支持或成功。
- 会话文件无法预览时不读取本地路径，不伪造文件内容，并显示文件名、类型和大小（若 Gateway 返回）。
- 三种已发布语言包含新增文案。
- 相关定向测试、TypeScript、Lint、完整测试、构建和差异检查通过。

## 未验证边界

- 当前连接所用 Gateway 的 `operator.admin` 设备授权和 `sessions.diff` 实际 scope 仍需在真实授权连接中验证；主线源码与本机运行时若有差异，界面保留未授权事实。
- macOS、Windows 和 Linux 桌面制品的真实悬浮、键盘焦点、窄窗口和弹层边界仍需人工验收。
