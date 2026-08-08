# OpenClaw Agent 引导文件只读投影规格

日期：2026-08-04

## 范围

在 Agent 设置中呈现 OpenClaw 官方 `agents.files.list/get` 的只读引导文件投影。

## 验收条件

- 读取请求仅传递已验证的 `agentId` 和由官方列表返回的文件名。
- 响应必须含有预期 Agent 身份和合法文件记录；主机工作区、文件绝对路径等字段不进入 JunQi 领域模型或 UI。
- 缺失文件保留官方 `missing` 和 `expectedAbsent` 语义，不由客户端创建或默认填充内容。
- 认证连接变化、断开、未知方法与不合法响应均 fail closed，不读取本机目录。
- 面板没有保存、编辑、创建、删除、上传或系统打开入口，也不调用 `agents.files.set`。
- 不改变现有 Agent 配置或通用工作区浏览边界。

## 非目标

- 不实现 `agents.files.set`，也不为该方法补造版本、CAS 或幂等协议。
- 不硬编码或推断 OpenClaw 的引导文件名集合。
