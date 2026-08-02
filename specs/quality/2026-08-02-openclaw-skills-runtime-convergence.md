# OpenClaw 技能运行时出口收敛

## 问题

技能管理页、侧栏和会话输入存在不同的解析与调用路径，部分 UI 操作由永远失败的桌面
适配器支撑，导致显示能力与实际 OpenClaw Gateway 契约不一致。

## 验收条件

- Gateway 技能 status、目录搜索、详情、启停和安装只通过一个强类型运行时服务。
- `skills.update` 与 `skills.install` 必须使用管理员权限请求，读取操作不得要求管理员权限。
- 技能页面不得展示当前协议未提供 command 支撑的删除、目录导入、ZIP 导入、SkillHub CLI
  或 ClawHub CLI 操作。
- 解析器只接受当前安装 OpenClaw 协议声明的字段，并安全忽略畸形记录。
- `/skill-hub` 的本地符号链接功能与 Gateway 技能管理保持独立。
- 定向测试、类型检查和差异检查通过。

## 非目标

- 不为当前协议不存在的删除或本地归档安装功能发明 RPC。
- 不使用第三方 HTTP 响应替代 Gateway 的技能目录或安装确认。
