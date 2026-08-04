# 本地 main 对齐与客户端边界审计

日期：2026-08-05

## 依据

- 根 `AGENTS.md`：JunQi 只是 OpenClaw 桌面客户端；客户端增强不得创造新的 Agent、Session、Tool、Gateway 或运行时语义。
- 本地 JunQi `main` 当前提交 `23864b18565ed37ef70bd8871aeacc75bb993134`。相对上一轮已合并基线 `b266510c`，新增提交为 `统一工作区文件预览并发布 2.2.2`。
- 本机同步的 OpenClaw 官方源码当前提交 `1e3880352e614116549c0a30c67a59a2d40ba259`。本次文件预览与视图稳定性不新增 Gateway 方法，只消费 JunQi 已有的文件和会话投影。
- 项目实际依赖和锁文件只用于复现构建，不作为 OpenClaw 能力开关，也不把当前开发机行为外推到其他目标系统。

## 双向差异结论

| 范围 | `main` 进入改动 | 审查处理 | 依据 |
| --- | --- | --- | --- |
| 版本 | 三处版本更新为 `2.2.2` | 保留 | `package.json`、Rust crate 与 Tauri 配置必须一致。 |
| JSON 预览 | 工作区、聊天结果和 Artifact 增加 JSON 只读预览 | 保留并加固 | 只扩展客户端展示，不改变 OpenClaw 数据；统一走文件能力解析和共享预览组件。 |
| JSON 格式化 | 使用原生数值解析后重新序列化 | 改为语法树格式化 | 原实现会改写超过安全整数范围的数字。当前实现保留数字和字符串字面量，并在格式化新增内容超过原文长度时原样显示。 |
| Agent Hub | 已有快照刷新时保留页面，视图切换保持挂载 | 保留并改为行为测试 | 仅稳定 JunQi UI，不推断新的 Gateway 状态。完整快照仍以 `sessions` 和 `agents` 两类既有成功时间为准。 |
| 旧工作区 | 重新带入 `WorkspacePanel`、`WorkspaceFileTree` 和临时页签 reducer | 删除 | 当前生产入口已经使用 `AgentWorkspace` 与 `OpenClawAgentWorkspacePanel`；旧文件和 reducer 没有运行时消费者。 |
| Orca 对齐文档 | 声称旧工作区入口已经实现临时页签和目录缓存 | 删除 | 文档引用已删除实现并把未进入生产链路的行为写成已完成，不能作为当前契约。 |

上一轮 `main` 主题收敛已在合并提交 `a5a6edfd` 中完成。该轮保留语义化主题 token，并修正暗色遮罩从白色覆盖色派生的问题；没有恢复全局 Tailwind 颜色重绑，也没有恢复不属于 OpenClaw 的第三方 Provider。

## 当前行为

### JSON 文件

- `.json` 由 `resolveWorkspacePreview` 判定为 JSON 模式；`.jsonc` 和其他代码文件保持源码模式。
- 工作区源码与预览共用同一个文档控制器，切换预览不会保存或改写草稿。
- `ManagedFilePreview` 使用项目直接声明的 `@lezer/json` 纯语法解析器格式化；叶子字面量直接取自原文，不经过数值序列化，也不加载编辑器视图或 WebView 环境。
- 语法树无法承载但标准 JSON 解析仍可确认有效的极深结构原样展示。标准解析结果不会被序列化或写回。
- 截断内容只显示“预览已截断”，不会把不完整片段误报为源文件无效。

### Agent Hub

- 只有 `sessions` 和 `agents` 都没有成功快照且正在加载时，页面才显示阻塞式加载状态。
- 已有完整快照后的刷新继续显示当前数据；刷新图标仍反映请求状态。
- 树状、活动和网格视图保留挂载，非当前视图通过原生 `hidden` 与 `aria-hidden` 退出布局和无障碍树。

## 硬编码与跨平台检查

- 没有新增固定用户目录、Gateway 地址、运行时路径、平台名称或操作系统分支。
- 文件扩展名继续由共享 `fileExtension` 处理 Windows 反斜杠、POSIX 路径和 URL；Artifact 与聊天入口不各自复制路径判断。
- JSON 格式化的内存边界从输入长度推导，不使用设备内存、当前 WebView 或经验倍率。
- 本次没有新增 Tauri command、系统 API 或浏览器运行时依赖，因此不宣称改变 Windows、Linux 或 macOS 的平台能力。

## 已执行验证

- JSON、Managed Preview、Agent Hub、聊天文件、Artifact、文件能力解析和 Windows 路径相关行为测试：25 项通过。
- `pnpm lint`：通过；模块边界检查覆盖 895 个文件，四处版本来源均为 `2.2.2`，TypeScript 无错误。
- `pnpm test`：通过；2823 项测试全部通过。日志仅包含既有 Node 注册接口弃用提示和 Radix 服务端渲染提示。
- `pnpm build`：通过；collaboration 包契约和打包通过，Vite 完成 9229 个模块转换，生成资源没有未提交差异。
- `git diff --check`：通过。

## 后续总体验证

- 恢复此前单独暂存的语音能力边界改动后，再执行 Rust、OpenClaw 文档和协作插件全量验证。

## 未验证边界

- Windows、Ubuntu、CentOS 和 macOS 的打包产物、真实窗口交互、输入设备与 Gateway 环境仍需对应目标平台真机验收。
- 自动化测试只证明数据与组件契约，不等同于亮色、暗色、窄窗口、键盘焦点及实际渲染性能验收。
