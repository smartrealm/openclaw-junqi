# Gateway 原生能力与扩展一致性整改计划

日期：2026-08-09

## 当前执行状态

- 第一批已完成：生产与测试共用扫描器，920 个生产文件零违规，两个已知运行时循环已删除。
- 第二批已完成直接协议修复：二维码权限、Chat delta/status、Wizard 官方终态和模型最小权限已有回归。
- 第三批已完成已确认范围：token 事件、死 resolver、遗留 Gateway 事件、写死 OAuth 与六个无消费者
  凭据 command 已删除。剩余 command 仍需消费者矩阵证明后再处理。
- 第四批已完成 store、transport 与发送协调器循环拆除；Agent stream 严格解码和历史源码文本测试迁移
  仍待继续。
- 第五批未执行：真实最新版 Gateway、macOS、Windows、Linux 和正式发布验证仍待受控环境。

## 实施原则

先修复验证器和协议正确性，再清理暴露面，最后拆除架构循环。每一批必须独立可回滚、先有失败回归、
不混入无关 UI 重构。OpenClaw 最新官方源码和真实 Gateway 回执是唯一上游事实来源。

## 第一批：让验证器可信

目标：关闭 GNE-01 的检查器假阴性，但不在同一提交机械迁移全部 130 个违规。

文件范围：

- `scripts/check-boundaries.mjs`
- `scripts/check-boundaries.test.mjs`
- 新增可复用的边界扫描模块
- 边界矩阵对应的规范文档

步骤：

1. 提取规则、导入解析、路径归一化和违规报告为一个可导出模块。
2. 用临时 fixture 目录调用同一生产实现，证明 `@/stores`、相对导入、动态导入和 direct invoke 均能识别。
3. 删除测试中的复制规则和错误说明。
4. 生成按业务域分组的当前违规基线，只允许显式、临时、带删除条件的迁移清单。
5. 先收敛两个已确认运行时循环，再逐域消除其余违规。

验证：`pnpm test:boundaries` 必须能在注入违规时失败；`pnpm check:boundaries` 最终零违规。

## 第二批：修复直接协议错误

### 2.1 二维码权限

文件范围：

- `src/services/channelQrLogin.ts`
- `src/pages/ChannelsCenter/ChannelQrLoginDialog.tsx`
- `src/services/channelQrLogin.test.ts`
- Gateway 权限连接组合根

步骤：先写管理员端口回归，再把 `start/wait` 与只读 verifier 分离注入。不得增加失败后改用普通连接的
fallback。

### 2.2 Chat 事件

文件范围：

- `src/services/gateway/ChatHandler.ts`
- 新增 Chat/Agent wire decoder 与 delta 投影纯函数
- `src/services/gateway/ChatHandler.test.ts`
- Connection 事件入口和相关类型

步骤：

1. 从官方 ChatEventPayload 和 server delta 行为建立本地严格解码类型。
2. 把 delta/snapshot/replace 合并抽为纯函数并复制官方关键行为 fixture。
3. ChatHandler 只消费解码结果，status 与终态走判别分支。
4. 对 Agent stream 逐类迁移，非法事件在边界失败关闭。
5. 删除被取代的 `any`、旧增量分支和只服务旧 fixture 的包装。

### 2.3 Wizard 终态

文件范围：

- `src/hooks/useSetupFlow/useWizardSession.ts`
- `src/services/openclawWizard.ts`
- Wizard 测试与首次启动文档、spec、plan、HTML 预览

步骤：

1. 增加“配置完整但官方会话丢失仍未知”和“终态说明后超时仍未知”回归。
2. 删除本地 done 合成和文本非阻断判定。
3. 建立官方 outcome、Gateway 连接、配置存在、模型验证四个独立状态。
4. 恢复动作只调用官方 status/resume/start 或明确的重新开始，不从本地状态补成功。
5. 更新 `docs/previews/junqi-first-run-flow.html`，明确未知和恢复路径。

### 2.4 会话模型权限

文件范围：

- `src/services/gateway/SessionSettingsClient.ts`
- `src/services/gateway/SessionSettingsClient.test.ts`
- 管理员连接生命周期测试

步骤：将 model 迁移到普通写端口；其余字段按最新版官方动态规则逐项核对。

第二批验证：定向测试、`pnpm lint`、完整前端测试、`pnpm build`、真实 Gateway 协议回放。

## 第三批：删除遗留事件和凭据暴露

### 3.1 启动凭据广播

文件范围：

- `src-tauri/src/lib.rs`
- `src/services/gateway/configResolvers.ts`
- `src/services/gateway/configResolvers.test.ts`
- 相关导出、安全测试和文档

步骤：完成全局生产者和消费者图后，一次删除事件、resolver、专属测试和说明。增加 WebView 事件载荷
不包含 token 的安全守护。

### 3.2 事件命名空间

文件范围：

- `src/stores/gatewayDataStore.ts`
- `src/hooks/useAgentWorkspaceTaskEvents.ts`
- Gateway 和 Tauri 事件类型、测试

步骤：建立官方 Gateway 事件联合与本地 Tauri 事件联合；确认插件事件注册后删除遗留顶层分支。不能把
Tauri task hook 改名伪装成 Gateway 事件。

### 3.3 Tauri command 暴露面

文件范围：

- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/secret_store.rs`
- `src-tauri/src/commands/provider_oauth.rs`
- `src-tauri/src/commands/config.rs`
- `src/api/tauri-commands.ts` 和 command 契约测试

步骤：生成消费者矩阵，优先移除无前端消费者的 secret/OAuth command；每次删除同时移除专属 wrapper、
测试、文档和生成来源。Rust 内部调用不受影响。

第三批验证：前端完整测试、Rust fmt/check/test、IPC 注册比对、安全扫描和 `git diff --check`。

## 第四批：拆除职责循环并迁移测试

文件范围：

- `src/services/gateway/Connection.ts`
- `src/services/gateway/ChatHandler.ts`
- `src/services/gateway/index.ts`
- `src/stores/chatStore.ts`
- `src/stores/gatewayDataStore.ts`
- `src/api/tauriCommandsContract.test.ts`

步骤：

1. 定义最小 connection lifecycle observer 和 decoded event port。
2. Connection 不再导入 store；组合根负责订阅和投影。
3. ChatHandler 不再直接操作多个 store，改为注入的消息、运行和失效端口。
4. store 不再导入包含 ChatHandler 的总 Gateway facade；只依赖窄化 client 或 action port。
5. facade 只组合稳定客户端，不承担解析、缓存、UI 回调和状态写入。
6. 将高风险源码正则测试迁移为可执行 schema、纯函数或注册 fixture。
7. 删除旧 facade 兼容导出和不再使用的包装层。

本批不要求面向对象类数量增加。优先组合、不可变值对象、判别联合和窄接口；只有需要替换实现或维护
资源生命周期时才使用类。

## 第五批：最新版真实运行验证

1. 基于已记录官方提交启动受控 Gateway。
2. 回放 QR 登录，验证管理员权限和结构化终态。
3. 回放只含 `deltaText`、replace、status、终态和非法载荷的 Chat 事件。
4. 复现 Wizard 会话交接、丢失、超时和恢复，确认没有本地伪成功。
5. 安装协作和钉钉插件，验证发现、权限、审批、重启和失败关闭。
6. 在 macOS、Windows、Linux 分别记录凭据库、WebView 暴露面和目标平台差异。
7. 运行完整仓库验证并形成 validation 文档；未完成真机项保持未验证。

## 禁止事项

- 不按 OpenClaw 版本号硬编码能力分支。
- 不因 `hello-ok.features.methods` 缺少方法而提前隐藏或拒绝调用。
- 不保留旧事件名、旧 resolver、旧 command 或本地成功 fallback。
- 不用管理员连接包住所有写操作。
- 不在一个提交中同时修协议、重做 UI 和迁移全部模块边界。
- 不以抽象基类、服务定位器或无消费者工厂替代明确的端口组合。
