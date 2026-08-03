# Gateway 凭据绑定失败关闭

日期：2026-08-03

## 依据

JunQi 的 GatewayCredentialBinding 在协作实例凭据提升前，需要读取当前选中
runtime 的 GatewayConfigInfo，使用其中的 credential_scope 生成 selected runtime key。
Native 和 Docker 可以共享同一个 loopback endpoint，因此 endpoint key 不能替代
selected runtime key。

## 发现的问题

原实现把 detectConfig() 的失败转换成 null，再交给
resolveGatewayConnectionCredentialRuntimeKey。若 URL 与配置无法核对，解析器会回退
到 endpoint key，绑定流程仍可能把共享端点上的凭据写入新的协作实例。

## 当前行为

- GatewayCredentialBinding 读取选中 runtime 配置失败时直接传播错误。
- bindCredential 不会被调用，也不会写入实例凭据、持久化 alias 或删除源凭据。
- 配置读取成功时，仍使用 credential_scope 生成 selected runtime source key，并由既有
  runtime identity fence 保护后续绑定。
- GatewayConnectionTargetResolver 的外部 endpoint 连接仍保留其独立的可选配置语义；
  本修复只收紧不可跨 runtime 的协作凭据绑定路径。

## 验证

- GatewayCredentialBinding.test.ts：3 项通过，新增配置读取失败且无 mutation 回归。
- pnpm exec tsc --noEmit --pretty false：通过。
- pnpm test：前端 2372 项、脚本 234 项全部通过。
- pnpm lint：通过；模块边界检查覆盖 802 个文件。
- pnpm build：通过，Vite 完成 9144 个模块，协作插件 bundle 校验通过。

## 未验证边界

- 未在 Windows Credential Manager、macOS Keychain 和 Linux Secret Service 真机上执行
  协作实例凭据提升。
- 未改变系统凭据库不可用时的 session_only 语义；该语义仍由 credentialProvider 契约
  和已有测试覆盖。
