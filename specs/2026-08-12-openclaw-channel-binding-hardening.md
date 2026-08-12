# OpenClaw 渠道绑定加固规格

## BUG-CHB-01：官方 Channels Wizard

当前：渠道中心分别使用终端、通用表单或二维码对话框新增渠道。

目标：新增与重新配置通过独立官方 Channels Wizard 会话完成；setup 与 channels 会话持久化范围隔离。

验收条件：

- [x] 支持的 Runtime 收到 `wizard.start { flow: "channels", channel }`。
- [x] 终态只使用官方返回的 channel/account。
- [x] 旧 Runtime 拒绝新参数时显示终端交接，不伪报失败或成功。

## BUG-CHB-02：Web Login 身份围栏

当前：任一渠道 capability 声明两个方法即可显示二维码。

目标：内嵌二维码要求所选渠道是唯一 Web Login provider，并且目标账号来自官方 Wizard 终态。

验收条件：

- [x] 多 provider 或身份未知时不调用 Web Login。
- [x] 请求不添加 OpenClaw 未定义的 channel 参数。
- [x] 二维码成功只采用官方 connected 终态。

## BUG-CHB-03：真实状态投影

当前：显式离线和 probe 失败仍可能显示 ready。

目标：所有显式失败优先于 ready，证据缺失保持 unknown。

验收条件：

- [x] running=false、connected=false、lastError 或 probe.ok=false 不显示 ready。
- [x] 未提供连接字段的纯 token 渠道不会被错误判定为离线。
- [x] 缺少凭据文案不显示空字段列表。

## BUG-CHB-04：账号级 capability

当前：只读取第一行 capability。

目标：归一化全部行，并按 channel/account 精确选择。

验收条件：

- [x] 多账号响应不会丢行。
- [x] 指定账号优先精确匹配，不存在精确项时只回退同渠道首行。
- [x] 插件 schema 与方法冲突时失败关闭。

## BUG-CHB-05：schema 与 uiHints

当前：联合 primitive 进入 JSON 文本区，uiHints 被丢弃，外层可保存无效草稿。

目标：支持官方提示、敏感字段、primitive 联合类型和结构化草稿状态上报。

验收条件：

- [x] 钉钉 clientId 使用普通输入，clientSecret 默认使用密码输入。
- [x] SecretRef 仍可通过结构化 JSON 输入。
- [x] 存在 JSON 错误或未应用草稿时禁用保存。

## BUG-CHB-06：授权交互反馈

当前：身份缺失，复制与打开错误静默，字符二维码重复占据页面。

目标：显示渠道和账号，操作失败内联呈现，终端字符二维码默认折叠。

验收条件：

- [x] 二维码标题区包含渠道和账号。
- [x] 剪贴板与 Shell 打开失败可见且可重试。
- [x] 授权 URL 和插件原始输出仍可访问。
