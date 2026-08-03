# Gateway 凭据绑定失败关闭规格

日期：2026-08-03

## 问题

协作实例凭据绑定必须绑定到已经验证的 selected runtime。配置探测失败时不能用共享
endpoint URL 猜测 runtime 归属。

## 目标行为

1. detectConfig 成功后，使用其 ws_url 和 credential_scope 生成 source runtime key。
2. detectConfig 失败时，绑定操作立即失败。
3. 失败路径不得调用凭据写入、alias 持久化或源凭据删除。
4. 既有 identity fence 和 Native/Docker 隔离规则保持不变。

## 验收条件

- 配置探测失败测试能证明 bindCredential 没有被调用。
- 配置成功测试仍能证明 sourceRuntimeKeys 使用 selected runtime scope。
- TypeScript、Gateway 定向测试、边界检查和差异检查通过。
