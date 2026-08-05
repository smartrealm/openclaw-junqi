# Agent 活动视觉语言接入记录

日期：2026-08-05

状态：代码与自动化完成，待桌面视觉和性能验收

## 依据

- `thinking-orbs` 0.2.0 提供 React 18 Canvas 2D 活动图形，使用 MIT License；其实现限制设备像素比、在离屏和页面隐藏时暂停，并在 `prefers-reduced-motion` 下绘制静态帧。
- JunQi 已有 `LoadingIndicator`，其职责是普通异步加载，不能被 Agent 动画无差别替换。
- `DynamicIslandSessionActivity.phase` 只投影 `thinking`、`generating` 和 `observing`；Chat 执行组只提供 `streaming` 和运行中工具数量。当前没有可靠的搜索、连接或求解阶段协议。
- `src/styles/index.css` 已有历史 Border Beam 类样式，但当前没有生产调用方。为避免重复依赖和无语义循环装饰，本次不引入 `border-beam`。

## 当前行为

- 新增共享 `AgentActivityIndicator`，业务层只可表达 `thinking`、`generating`、`working` 和 `listening`。
- Aegis Dark 与 Midnight 使用暗底图形；Light 与 Eyecare 使用亮底图形。组件不根据操作系统偏好绕过应用主题。
- Chat 思考区使用 `thinking` 图形，并删除同一标题行上重复的三点循环动画。
- Chat 执行组在存在运行中工具时显示 `working`，仅有推理流时显示 `thinking`。
- 灵动岛根据已投影的会话、语音和任务状态显示活动图形；空闲时继续显示 JunQi 标识，需要处理和失败状态继续使用原状态提示。
- Agent Hub 只在 Agent 聚合卡片上显示一个 `working` 图形；普通加载、保存、刷新和日志读取继续使用 `LoadingIndicator`。
- 灵动岛活动态使用 Aegis Primary 的静态边框和低强度光晕，不增加独立 Border Beam 运行时。

## 安全与语义边界

- 不从自然语言、工具名称或模型输出猜测 `searching`、`solving`、`connecting` 等状态。
- Canvas 是辅助图形；可见状态文字继续存在。已有可见文字时图形为装饰元素，独立使用时必须提供本地化标签。
- 不改变 Gateway、Store、Tauri IPC、会话或任务状态契约。
- 不在终端、编辑器、普通设置、Provider、渠道、按钮或历史完成项中增加 Agent 动画。
- `thinking-orbs` 通过 JunQi 包装组件隔离，业务组件不得直接依赖其九状态 API。

## 验证

- 组件测试覆盖状态映射、四主题明暗映射、装饰和独立无障碍语义。
- Chat 回归覆盖重复动画移除和工具运行状态映射。
- 灵动岛回归覆盖投影阶段映射及重复 Spinner 移除。
- TypeScript、模块边界、完整前端测试和生产构建按实施计划执行。

## 未验证边界

- 尚未在 Tauri 桌面完成 Light、Dark、Eyecare、Midnight、窄窗口和键盘视觉走查。
- 尚未在 Windows 125% 与 150% 缩放、高 DPI 和低性能设备验证 Canvas 清晰度、滚动帧率和功耗。
- 尚未用系统 Reduced Motion 真机确认静态帧效果。
- 当前没有真实 Gateway 活动录屏或自动截图基线，因此动画节奏和状态辨识度仍需人工验收。
