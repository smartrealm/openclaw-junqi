# Windows Gateway 冷启动与默认主会话固定审计

日期：2026-08-08

## 依据

- OpenClaw 官方 `agents.list` 返回 `defaultId`、`mainKey`、`scope` 和智能体列表；
  `mainKey` 是当前默认智能体主会话的权威身份。
- OpenClaw 官方主会话文档把 `agent:<agentId>:main` 定义为智能体根会话，并在官方 Web
  界面中作为 Home 的第一入口。
- OpenClaw Windows 原生 Gateway 使用官方服务生命周期；JunQi 冷启动只负责核验当前选定
  state/config、恢复该运行时并建立经认证的 Gateway 连接。
- `/Users/wei/DevTool/project/mine/gui/openclaw-desktop` 将默认主会话保留为第一个不可关闭入口，
  仅作为桌面交互参考；会话身份仍以 OpenClaw 官方 `agents.list.mainKey` 为准。

## 当前问题

### Windows 重启后显示 Gateway 未连接

`GatewayConnectionTargetResolver` 优先读取用户持久化的 Gateway 地址。原实现只用字符串全等
判断该地址是否属于当前选定运行时。当持久化地址是 `ws://localhost:<port>`，而 OpenClaw 配置
返回 `ws://127.0.0.1:<port>` 时，两者实际指向同一回环端点，却被当成不同 Gateway。随后连接
解析器不会读取当前选定运行时的 token，而改走独立设备凭据路径，冷启动认证因此可能失败。

该问题不是 Windows 服务未启动的充分证据。Windows 官方服务恢复仍由既有
`ensure_gateway_running`、服务归属核验和认证探测负责；本次只修复连接目标身份误判。

### 默认主会话只在渲染层临时靠左

`ChatTabs` 当前在渲染时把 `mainSessionKey` 临时放到首位，但 `chatStore.openTabs` 仍允许关闭和
重排该会话，快捷切换也按未规范化的底层顺序计算。因此界面顺序、持久化顺序和键盘切换顺序
可能不一致。

## 目标行为

1. 同协议、同规范化主机、同端口、同路径的 Gateway 地址属于同一端点；回环地址
   `localhost`、`127.0.0.1` 和 IPv6 回环表达不因字符串差异丢失选定运行时凭据。
2. 不同端口、路径、协议或远端主机仍保持不同 Gateway 身份，不继承选定运行时 token。
3. 以 `agents.list.mainKey` 作为默认主会话固定身份；连接前只保留现有默认占位，收到官方快照后
   立即收敛到权威身份。
4. 默认主会话始终是第一个页签，不可关闭、不可拖离左侧；其他会话仍可关闭和相互排序。
5. 渲染、持久化、前后页签切换使用同一规范化顺序，不保留仅供显示的第二套排序。

## 实现结果

- `GatewayConnectionTargetResolver` 使用统一的 Gateway 端点规范化规则判断当前地址是否属于所选
  runtime。相同协议、端口和路径下，`localhost`、IPv4 回环与 IPv6 回环不再因为字符串不同而
  丢失所选 runtime 的认证 token。
- 首次配置只持久化当前 Gateway 地址首选项 `aegis-gateway-url`。旧的 `aegis-config` 浏览器存储
  结构及其清理包装已删除，不再保留双轨读取、兼容迁移或凭据承载路径。
- `chatStore` 以单一规范化函数维护页签顺序。收到 `agents.list.mainKey` 后，默认主会话立即固定到
  `openTabs` 首位，持久化、拖拽、快捷切换和渲染共用同一顺序。
- 默认主会话不显示关闭入口、不响应中键关闭、不可拖拽，也不能从会话操作菜单或会话管理页删除。
  其他页签仍可关闭和排序。
- 未修改 OpenClaw Windows 服务安装、Scheduled Task、token 生成、设备审批和 Gateway 生命周期
  语义；现有服务恢复链继续负责启动和认证探测。

## 验证结果

- 回归测试已证明修复前 `ws://localhost:<port>` 与 `ws://127.0.0.1:<port>` 会丢失所选 runtime
  token；修复后复用所选 token，且不读取独立设备凭据。
- 已覆盖默认主会话关闭、拖拽排序、官方自定义 `mainKey` 收敛和远端删除保护。
- 已覆盖首次配置只写入当前 Gateway 地址首选项，不再创建历史 `aegis-config` 结构。
- TypeScript 静态检查和模块边界检查已通过。完整测试、生产构建和差异检查结果以根目录
  `PROJECT_STATUS.md` 的本轮记录为准。

## 未验证边界

- 当前环境不能替代 Windows 真机验证 Scheduled Task、Credential Manager、登录后服务启动和
  安装包冷启动时序。
- 本次不改变 OpenClaw 服务安装、服务重建、token 生成、设备审批或配对协议。
