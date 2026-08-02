# 业务引导审计

日期：2026-08-02

## BUG-GUIDE-01

首次引导关闭或完成后只更新内存 `tourOpen`，持久化状态未记录已查看事实。组件重新挂载会再次弹出。目标是持久化非敏感 `tourSeen`，重新打开时才显式打开。

## BUG-GUIDE-02

总览组件注入 `AppLayout` 的每个路由视口，导致页面引导与业务页混排。目标是只在总览入口显示任务区，弹窗作为独立全局层保留。

## BUG-GUIDE-03

渠道任务只依据 Gateway 连接，不读取 Runtime 的 `channels.status`。目标是仅在现有 `assessChannelAccountReadiness` 判定至少一个账号为 `ready` 时完成；状态不可用时受阻。
