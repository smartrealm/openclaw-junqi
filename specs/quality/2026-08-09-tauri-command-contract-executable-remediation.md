# Tauri Command 可执行契约整改规格

日期：2026-08-09

## 目标

将 Tauri IPC 守护从依赖源码文本、函数排列和正则片段的方式，收束为两类可复现验证：

1. 通过 Tauri JavaScript 内部 invoke 桥捕获关键包装器的实际 command 名与 JSON 参数。
2. 仅对无法通过单个包装器验证的静态注册关系，验证生产代码中的直接字面量调用均出现在 Rust 注册表。

## 范围

- Gateway 启动、重启、停止、选定运行时探测与运行时快照。
- Gateway 设备签名、设备批准、钉钉安装和授权操作。
- OpenClaw 官方渠道的目录、能力、状态与日志查询。
- 持久通知的空值、单项与批量操作。
- 原生语音采集、Talk 播放、OpenClaw 媒体预览和控制 UI。

## 约束

1. 测试必须断言实际 command 和参数，而非断言 TypeScript 源码字符串。
2. 零参数调用按 Tauri JavaScript 内部桥的真实 `{}` 形态断言，不能把包装函数省略参数误当成 wire 形态。
3. 渠道返回继续保持 `unknown`，由渠道服务解析；测试不得伪造 OpenClaw 渠道字段。
4. Rust 注册表测试只断言直接字面量调用是否存在注册项，不断言函数的源码位置、变量名或实现写法。
5. 真实 Tauri WebView 与 Rust handler 的端到端调用仍属于桌面真机验证，不能由 Node 模拟替代。

## 验收

- `src/api/tauriCommandsContract.test.ts` 不再读取或正则匹配业务源码。
- 高风险包装器的 command、参数嵌套、默认值和解码失败关闭由运行时测试覆盖。
- `scripts/tauri-command-registry-contract.test.mjs` 验证所有生产直接字面量调用均在 Rust 注册表中。
- TypeScript、Rust 定向检查和完整验证阶段通过后，才能描述为自动化验证完成。
