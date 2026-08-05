# OpenClaw 浏览器控制实施计划

## 实施项

- [x] 核对已安装 OpenClaw 的 `browser.request` Gateway 契约、权限和浏览器控制路由。
- [x] 新增严格的浏览器协议客户端，校验输入和 Gateway 响应。
- [x] 复用短时管理员请求器，不改变日常 Gateway 连接 scope。
- [x] 新增会话顶部浏览器入口、profile 状态、标签页操作和快照展示。
- [x] 对既有登录态 profile 的读取或修改操作增加本机确认。
- [x] 增加三语言短文案和客户端回归测试。
- [ ] 使用真实 Gateway 分别验证隔离 profile、现有浏览器会话和扩展连接 profile。
- [ ] 在 macOS、Windows 和 Linux 目标环境验证浏览器发现、权限审批及关闭行为。

## 验证顺序

1. 运行浏览器协议客户端回归测试和 TypeScript 类型检查。
2. 运行边界检查、完整前端测试、生产构建和 `git diff --check`。
3. 记录真实 Gateway 和目标平台验证结果；自动化结果不替代浏览器或登录态的现场验收。
