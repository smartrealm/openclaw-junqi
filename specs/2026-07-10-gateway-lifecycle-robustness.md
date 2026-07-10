# Gateway 生命周期健壮性修复规格

## BUG-GL07 · 超时重启进程清理

**Current**：重启 CLI 超时后仍存活，函数在其存活期间启动托管兜底。

**Target**：进入任何托管兜底前，重启 CLI 已被终止并完成回收。

**Acceptance**：
- [x] timeout 分支显式调用统一 Child 终止函数。
- [x] wait error 分支同样完成清理。
- [x] 清理完成后才调用托管兜底。

## BUG-GL08 · 精确合并重复重启

**Current**：任何操作锁竞争都会吞掉重启请求。

**Target**：仅合并等待期间已完成的另一场重启；其他生命周期操作结束后仍执行重启。

**Acceptance**：
- [x] Gateway 全局状态保存单调递增的重启完成代次。
- [x] 重启等待者比较进入前后的代次。
- [x] 重启完成或失败均通过 RAII 推进代次并清理 restarting 标记。

## BUG-GL09 · 前端生命周期代次

**Current**：旧 probe/start/resolve Promise 可以提交到新生命周期。

**Target**：reset、reconnect、destroy 会使此前异步工作失效。

**Acceptance**：
- [x] Manager 为每轮生命周期分配 generation。
- [x] probe、START 和 CONNECT 的异步提交检查 generation。
- [x] destroy 后不再产生状态提交或 WebSocket 连接。

## BUG-GL10 · 串行状态轮询

**Current**：`setInterval` 可同时运行多个状态探测。

**Target**：同一订阅最多只有一个状态探测在途，停止后不回调。

**Acceptance**：
- [x] 下一轮只在上一轮完成后调度。
- [x] 所有 await 边界后检查订阅代次。
- [x] cleanup 同时取消计时器并使在途请求失效。
- [x] cleanup 早于 Tauri `listen()` 注册完成时，迟到的监听器立即自解除。
