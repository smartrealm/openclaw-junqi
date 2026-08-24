# 钉钉工作台状态收敛计划

## 实施顺序

1. 为目录空状态、详情权限展示、schema 请求围栏、DWS 启动门禁和缓存回收添加修复前可失败的行为测试。
2. 提取最小的 schema 请求代次协调器和 DWS 操作缓存清理函数，不新增第二套运行时语义。
3. 在工作台中绑定 Session、工具和请求代次，切换 Session 时统一清理交互草稿。
4. 为 DWS 操作增加 starting 展示状态，并让所有忙碌判断复用同一判据。
5. 删除详情中的重复权限投影，按目录可用性传递准确空状态标题与说明。
6. 将本轮新增或修改的状态文案加入中、繁、英语言资源。
7. 在 DWS schema 已证明参数缺失或 JSON 无效时直接展开参数输入，并保持字段含义只来自 DWS schema。
8. 将工具表、详情、Profile 选择器和插件安装进度的固定客户端文案统一接入中、繁、英语言资源。
9. 将工作台官方文档入口接入受控桌面外链打开器，并保留失败反馈。
10. 为客户端可识别的 DWS 参数契约错误建立稳定错误码，并在页面按语言资源映射；保留 Gateway 与 DWS 原始运行时诊断。
11. 让同一 Session 的审计刷新失败保留已确认账本记录；断开和 Session 缺失仍清空范围，补充状态回归测试。
12. 拆开 Session 工具可见性与钉钉插件 Agent 门禁：用当前运行时探针成功作为门禁核验依据，未核验时复用授权配置入口和本地化说明。
13. 复核 Session 模型目录的视口边界、滚动容器和筛选数量，不让运行参数挤占模型清单。
14. 将业务审计页的本窗口投影、摘要、筛选和清理操作收紧到当前精确 Session，补充跨 Session 隔离回归测试。
15. 将 DWS 身份快照的发布门禁收紧到当前工具修订已结算状态，避免策略刷新期间复用旧 Profile。
16. 删除没有上游结果 schema 依据的审批追溯解析、自动重读与其专属语言资源和测试。
17. 运行定向测试、完整前端测试、lint、构建和差异检查；完成后回写 `PROJECT_STATUS.md`。

## 文件范围

- `src/pages/BusinessApplicationsPage.tsx`
- `src/components/BusinessApplications/DingTalkToolTable.tsx`
- `src/components/BusinessApplications/DingTalkToolDetail.tsx`
- `src/business-applications/dingtalkToolRequestCoordinator.ts`
- `src/business-applications/dwsOperationEventCache.ts`
- `src/hooks/useDingTalkBusinessAudit.ts`
- `src/business-applications/activityStore.ts`
- `src/components/BusinessApplications/BusinessActivityList.tsx`
- `src/components/BusinessApplications/DingTalkReadinessPanel.tsx`
- `src/components/BusinessApplications/dingTalkReadiness.ts`
- `src/business-applications/dingtalkRuntimeIdentityCoordinator.ts`
- `src/components/Chat/session-runtime/SessionRuntimeControl.tsx`
- 对应测试与语言资源

## 验证顺序

1. 定向 Node 测试。
2. `pnpm dingtalk:test`。
3. `pnpm test`。
4. `pnpm lint`。
5. `pnpm build`。
6. `git diff --check` 与 Emoji 扫描。
7. 真实桌面亮色、暗色、窄窗口和连续切换操作，若未执行则明确记录未验证。

## 当前结果

- 步骤 1 至 6、8、9、15、16 和 17 已完成并通过自动化验证。
- 步骤 7 因浏览器控制插件入口版本漂移未完成，保留为真实桌面视觉验收项。
