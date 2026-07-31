# 本机 System Service 协作启用归属修复计划

日期：2026-07-31

## 实施顺序

1. 在 `gateway_service.rs` 暴露选定 Native service 的只读归属检查，并集中定义“正在运行的选定 service”谓词。
2. 在 `ensure_gateway_running` 的健康端点快速路径中，内存 owner 缺失或为 External 时重新核验官方 service；精确匹配才恢复 `SystemService`。
3. 在普通 `start_gateway` 的健康端点复用路径执行同一恢复，避免入口不同造成 owner 漂移。
4. 保持 collaboration bootstrap 对 External 的只读限制不变。
5. 增加 Rust owner 判定和前端 collaboration setup 决策回归测试。
6. 更新协作文档，记录本机 System Service 与真正 External Gateway 的产品差异。

## 验证

```bash
node --import ./test-setup.ts --import tsx --test \
  src/stores/collaborationSetupStore.test.ts \
  src/components/Collaboration/CollaborationSetupDialog.test.tsx
pnpm lint
pnpm test
cd src-tauri
cargo fmt -- --check
cargo check --lib
cargo test --lib
cd ..
git diff --check
```

## 真机边界

- macOS：JunQi 未运行时由 launchd 启动 Gateway，再启动 JunQi，确认 Chat 显示应用内“启用协作”。
- Windows：Scheduled Task 冷启动后重复同一验收。
- Linux：systemd service 冷启动后重复同一验收。
- External remote 和归属冲突实例必须继续保持只读。
