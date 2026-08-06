# 首次启动凭据授权收敛

日期：2026-08-07
状态：实现完成，待 macOS 真机验收

## 依据

- OpenClaw Gateway 的 `connect` 握手同时要求设备签名，并允许共享 Gateway token 或设备 token 认证。
- OpenClaw 官方 Control UI 会生成稳定设备身份并持久化到客户端状态；常规 WebSocket 客户端需要设备签名，但协议没有要求客户端必须使用系统凭据库。
- JunQi 的共享 Gateway token 来自所选 OpenClaw 配置。设备 token 只在没有共享 token 时才参与握手。

## 问题

启动连接已从当前选定 OpenClaw 配置取得共享 Gateway token 后，仍创建并读取 JunQi 自有的设备身份 Keychain 项；解析器还可能读取第二个设备 token Keychain 项。macOS 因此可能连续显示两次授权，即使这些凭据不会参与共享 token 握手。

## 调整

- 共享 Gateway token 存在时，不读取系统凭据库中的设备 token。
- 共享 token 握手返回的设备 token 仅保留在当前进程，不在首屏自动写入系统凭据库。
- 设备签名私钥改为写入 JunQi 应用私有配置目录，并在 Unix 平台设置 `0600` 文件权限；不再触发系统凭据授权。
- 无共享 token 的连接和用户完成设备配对后，设备 token 仍按现有系统凭据边界处理；该路径只有在确实需要已配对设备 token 时才会访问。

## 工作区首屏

- 会话列表是进入工作区的唯一必需 Gateway 快照，因为它直接决定当前任务和消息入口。
- `agents.list` 是后台投影；其失败只影响智能体相关页面，不再阻塞仪表盘首屏。

## 验证范围

- Gateway 连接目标解析测试验证共享 token 路径不访问设备 token 凭据。
- Gateway 握手测试验证共享 token 路径不自动写入设备 token。
- 尚未在新的 macOS 安装包和空 Keychain 环境中完成真机授权次数验收。
