# 设备审批体验复审

日期：2026-08-03

## 依据

- Windows 真机在 OpenClaw 2026.7.1-2 上返回 `PAIRING_REQUIRED`，用户执行界面给出的 `openclaw devices approve <requestId>` 后，OpenClaw CLI 明确返回批准成功，但 JunQi 审批界面仍持续等待。
- OpenClaw 2026.7.1-2 随包实现将 `openclaw devices approve <requestId>` 映射到官方 `device.pair.approve`，并在 Gateway RPC 不可用时保留本地配对存储回退及请求身份核对。
- OpenClaw 明确禁止待升级设备通过同一低权限连接自行批准 scope upgrade；因此 JunQi 不能用正在申请权限的 WebSocket 自行绕过审批，但可以在用户明确确认后，通过当前选定且已核对的本机 OpenClaw CLI 执行官方批准动作。

## 已证实缺陷

### BUG-PAIR-01 · 手工批准后审批界面不收敛

管理请求的默认 30 秒预算同时限制了配对等待，而界面文案声称可等待 5 分钟。请求失败或超时后，审批 issue 没有被清理，界面因此可能继续显示“每 5 秒重试”，即使原管理请求已经不再具备可恢复状态。

目标：配对等待使用独立的 5 分钟授权预算；授权结束、失败或取消后，审批界面必须与真实请求状态同步。批准后立即触发下一次授权探测，不要求用户等待固定轮询间隔。

### BUG-PAIR-02 · 本机首次安装把官方 CLI 命令交给普通用户

当前界面只展示和复制命令，要求用户打开终端、识别 Gateway 所在机器并粘贴 request ID。对于 JunQi 管理的当前选定本机 Native 或 Docker runtime，这些信息和执行能力都已在应用边界内，不应转嫁给用户。

目标：界面先解释待授予的是设备管理权限，并要求用户明确确认；确认后由 Rust 后端使用当前选定 runtime、state 和 config 执行官方 `openclaw devices approve <requestId>`。request ID 必须按 CLI identifier 校验，不能拼接 shell。成功后立即恢复原管理请求。命令复制仅作为自动批准失败或远程 Gateway 场景的高级回退。

## 安全边界

- 不静默批准；必须由用户点击确认。
- 不读写 OpenClaw 私有配对文件；只调用当前安装版本提供的官方 CLI。
- 不通过 shell 拼接参数；request ID 作为独立参数传递并限制字符集和长度。
- 不记录 Gateway token、device token 或其他凭据。
- 自动批准失败不得伪成功；界面保留可读错误和高级手工回退。
- 当前选定 runtime 在操作期间的归属仍由既有 OpenClaw CLI target 解析负责；不得切换 Native 或 Docker。

## 同次实测暴露的相邻缺陷

### BUG-PAIR-03 · Ready 页面被后台自启动交接阻塞

Gateway 已验证就绪后，Ready 页面仍将 Gateway 自启动和 JunQi 自启动的后台操作纳入主按钮禁用条件。用户因此看到“就绪”却不能进入仪表盘。

修复：后台偏好操作继续显示真实进度并阻止返回，但不再阻止“进入仪表盘”；进入动作仍执行最终 Gateway 身份、onboarding 和模型门禁。

### BUG-PAIR-04 · 智能体首批数据请求丢失方法 receiver

`gatewayDataStore` 将 `ticket.connection.request` 作为裸函数传给 session lifecycle client，`GatewayConnection.request()` 内读取 `this.ws` 时 `this` 为 undefined，导致智能体页显示 `Cannot read properties of undefined (reading 'ws')`。

修复：通过闭包调用 `ticket.connection.request(method, params)`，保留连接对象 receiver；增加回归守护。

### BUG-PAIR-05 · 渠道 Runtime 加载被渲染为空状态

渠道页只用配置文件的 `loading` 控制首屏。官方渠道目录和 runtime status 尚未返回时，页面已经使用初始空目录渲染；目录调用失败又在 service 层被吞成 `unavailable + []`，用户看不到 loading 或错误。DingTalk 是受审的 JunQi-managed 外部插件，但 OpenClaw 不会在未安装时列出任意第三方插件，因此全新环境也没有安装入口。

修复：渠道目录和 runtime status 拥有独立首屏 loading 与骨架；失败明确显示错误，不伪装为空目录；Rust 只向官方目录补入受审 DingTalk connector 的“可安装”能力，安装后的 schema、状态、账户和行为仍完全由当前 OpenClaw runtime 返回。

## 验证边界

代码与自动化只能验证命令注册、参数边界、状态机和 UI 契约。Windows Credential Manager、真实 scope upgrade、CLI 本地回退、批准后原 Wizard RPC 仅执行一次，以及真实 DingTalk 插件安装和扫码仍需 Windows 真机复测。
