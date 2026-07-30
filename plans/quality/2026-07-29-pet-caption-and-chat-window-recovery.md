# 萌宠文字与聊天窗口恢复计划

日期：2026-07-29

## 实施

- [x] 复现萌宠采样不可用时返回空样式的策略缺口。
- [x] 将安全文字色设为无条件基线，自适应采样降级为增强能力。
- [x] 修正采样不可用时固定使用深色安全样式的问题，改为由萌宠独立窗口的实际明暗主题决定回退文字色。
- [x] 移除提示文字周围的卡片底板和边框，仅保留高纹理壁纸下的受控文字阴影。
- [x] 将位置事件的 400ms 防抖改为 120ms 限频、单飞且保留最新请求的采样调度器，使拖动过程持续跟随当前位置配色。
- [x] 修正设置文案，区分自适应配色与基础可读性。
- [x] 定位 ChatView 首次历史同步的未消费 Promise。
- [x] 在初始化调用边界消费已投影到聊天恢复提示的异常。
- [x] 增加修复前失败的回归测试。
- [x] 完成全量静态检查、测试、生产构建和 Apple Silicon 本地桌面打包。
- [ ] 在目标壁纸和 Gateway 断连条件下完成 Tauri 真机交互验证。

默认发布配置已生成 DMG 和应用包，但 updater 签名因未提供
`TAURI_SIGNING_PRIVATE_KEY` 按预期失败。随后使用仅作用于本次命令的配置关闭 updater
制品并以 `--no-sign` 成功生成本地预览 DMG；它不属于正式签名或公证发布包。

## 文件边界

- `src/pet/backdropContrast.ts`
- `src/pet/backdropSampleScheduler.ts`
- `src/pet/PetBubble.tsx`
- `src/components/Chat/ChatView.tsx`
- `src/locales/{en,zh,zh-TW}.json`
- 对应测试、规格和验证记录

## 回滚边界

改动不修改桌面采样 IPC、Gateway 协议或会话数据，只调整展示策略和调用方 Promise 所有权。
