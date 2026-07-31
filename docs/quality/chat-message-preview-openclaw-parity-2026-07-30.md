# Chat 消息预览与 OpenClaw 对齐

## 依据

- OpenClaw 官方仓库 `v2026.7.1`，提交 `2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4`。
- `ui/src/pages/chat/components/chat-message.ts` 使用 `panelRightOpen` 作为助手消息的 `Open in canvas` 操作。
- `ui/src/pages/chat/chat-view.ts` 和 `ui/src/styles/chat/sidebar.css` 将预览作为聊天右侧分栏；窄窗口将分栏提升为应用内全屏层。

## 当前行为

- 消息动作中的眼睛图标只在 HTML 或 SVG 产物可预览时出现。
- 图标直接切换产物卡内部的预览页签，无法预览完整助手回复。
- 主聊天与 Quick Chat 没有统一的消息预览容器。

## 目标行为

- 非流式且有正文的助手消息显示 `PanelRightOpen` 图标，语义为“在画布中打开”。
- 主聊天在右侧打开预览分栏，聊天记录和输入框不卸载。
- Quick Chat 在自身窄窗口中打开覆盖式预览，关闭后恢复原有滚动位置。
- 预览只渲染现有已清洗的 Markdown，不执行消息中的任意 HTML。
- 产物卡内部的预览与源码切换继续由产物卡负责。
- 主聊天与 Quick Chat 复用同一预览状态 hook；会话切换统一关闭旧消息预览。

## 验证边界

- 本次对齐消息级 Markdown 预览和桌面交互，不声明支持 OpenClaw Gateway Canvas 插件 URL。
- Gateway Canvas 插件面需要另行核对 `pluginSurfaceUrls.canvas`、允许来源和 iframe sandbox 契约后接入。

## 验证结果

- `pnpm lint`：通过。
- `pnpm test`：通过；脚本测试 224 条全部通过。
- `pnpm build`：通过，未出现循环分包或超出共享 JavaScript chunk 预算的警告。
- `git diff --check`：通过。
- Vite 本地入口可加载；未将浏览器壳检查视为 Tauri 桌面真机验收。
- 尚未在带真实 Gateway 会话的 Tauri WebView 中完成鼠标、触控和窄窗口点击验收。

## 2026-07-31 补充：预览本地化与输入菜单布局

### 依据

- `ChatMessagePreviewPanel` 读取 `chat.messagePreviewTitle` 和 `chat.closeMessagePreview`。
- 输入区的添加和语音操作位于会话可滚动布局树中；当右侧语音菜单以自身左边缘对齐时，菜单宽度会越过窗口右边界并创建横向滚动范围。
- 项目已有的 `DropdownMenuContent` 通过 Radix Portal 和碰撞处理在布局树外呈现菜单。

### 修复

- 将预览标题和关闭标签从错误的 `common` 位置移动到 `chat`，并在简体中文、繁体中文和英文语言包中保持完整一致。
- 添加、截图、录音和连续听写操作复用 `ComposerActionMenu`。该组件使用共享门户菜单、顶部展开、逻辑起止对齐和视口碰撞边界，不参与会话宽度计算。
- 提及、斜杠命令和参数选择器复用 `ComposerSuggestionPopover`。该组件锚定输入框但通过门户渲染，统一顶部展开、视口碰撞、关闭后恢复文本输入焦点和方向传递，因此不会再把菜单宽度计入聊天滚动容器。
- 输入栏、内部工具行和文本输入均显式允许收缩，防止窄窗口下的控制项扩大聊天容器。

### 验证

- `node --import ./test-setup.ts --import tsx --test src/components/Chat/MessageInput.composer.test.ts src/components/Chat/chatMessagePreviewUi.test.ts src/components/Chat/message-input/composerSuggestionDomain.test.ts`：13 项通过。
- `pnpm lint`：通过，模块边界检查 664 个文件通过。
- `pnpm test`：通过；脚本测试 224 项通过。
- `pnpm build`：通过。
- 仍需在真实 Tauri WebView 中打开语音、提及、斜杠命令和参数选择器，并确认桌面窗口不存在横向滚动条；本次自动化环境没有可用的浏览器控制实例。

## 2026-07-31 补充：会话本地化与展示一致性

### 修复

- 三套语言包补齐 Chat 静态键；Chat 组件不再嵌入静态 `t(key, fallback)` 或 `defaultValue` 展示文案。
- 工具显示名使用 `chat.tools.*` 语言键；未知上游工具保留其原始协议名称。
- 工具输入、输出、截断和错误标题复用 `chat.trace`。
- 文件卡片、语音、截图、代码折叠、系统提示、产物摘要、模型切换、思考摘要和启动历史状态均从语言包读取。
- 输入菜单和建议选择器通过 Portal 渲染，不再扩大聊天滚动容器。
- 助手消息的预览和复制操作位于气泡右上角；用户消息的复制、编辑、重试和删除仍保留在底部操作区，避免两种权限模型混在同一工具栏。
- 主聊天、消息预览和执行追溯复用 `chat-scrollbar`，在 WebKit 中使用 4px 轨道，并保留主题滚动条颜色。

### 回归保护

- `chatLocalization.test.ts` 检查 Chat 静态键、文件卡片动态元数据键，以及禁止静态翻译后备文案。
- 协作共享组件仍使用既有的注入式翻译兼容契约；其缺失语言项必须在完整三语资源齐备后统一迁移，不能由 Chat 局部绕过或伪造默认值。
- `AudioPlayer` 的调试日志使用纯文本状态标记，不保留 Emoji。
- `toolCallLocalization.test.ts` 检查每个内置工具显示键在三套语言包中均有非空值。
- `chatMessagePreviewUi.test.ts` 验证助手气泡顶部操作区和三处聊天滚动容器的共享细滚动条。
- 工具图标注册表以工具语言键集合为 TypeScript 约束，新增或遗漏映射会在类型检查中失败。

### 验证

- `pnpm lint`：通过，模块边界检查 665 个文件通过。
- `pnpm test`：通过，前端 1997 项和脚本测试全部通过。
- `pnpm build`：通过；重新生成 Provider Catalog，并完成协作插件验证与打包。
- `git diff --check`：通过。

### 未验证边界

- 自动化环境没有可用的桌面浏览器控制实例；尚需在真实 Tauri WebView 中验证窄窗口语音菜单、建议菜单和消息预览的无横向滚动表现。
