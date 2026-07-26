# OpenClaw 渠道 Runtime 权威源修复规格

## 总体约束

除钉钉受审插件安装和旧配置迁移外，生产代码不得根据具体渠道 ID 决定渠道是否存在、字段、默认值、能力、排序、readiness、登录或投递资格。

### BUG-CRA-01 · 静态模板

**Current**：JunQi 模板驱动非钉钉渠道的默认配置、字段和 readiness。

**Target**：当前 Runtime catalog/capability/status 是唯一事实源；JunQi 通用编辑只保留原字段并编辑 Runtime schema 声明的字段。

**Acceptance**：
- [ ] 非钉钉渠道模板不再存在于生产配置链路。
- [ ] 新渠道不会被注入 JunQi policy、streaming 或媒体默认值。
- [ ] Runtime 状态不可用时不按静态凭据字段判错。

### BUG-CRA-02 · 飞书专项安装向导

**Current**：JunQi 内置飞书注册协议并启发式匹配 OpenClaw wizard。

**Target**：OpenClaw wizard 原样驱动所有渠道；JunQi 只提供通用 QR 展示。

**Acceptance**：
- [ ] Setup 生产代码无 Feishu/Lark 渠道分支。
- [ ] Native 无飞书 enrollment endpoint 或 session registry。
- [ ] 通用 QR renderer 继续可用。

### BUG-CRA-03 · 日历投递渠道

**Current**：固定五个渠道并默认 Telegram。

**Target**：从当前 Runtime status 获取可投递渠道；`last` 是唯一静态通用选项。

**Acceptance**：
- [ ] `DeliveryChannel` 接受动态 ID。
- [ ] 默认值为 `last`。
- [ ] Runtime 返回的新渠道自动出现，失败时不展示静态回退全集。

### BUG-CRA-04 · Agent 快捷创建

**Current**：固定创建 Feishu/旧 DingTalk 账号和字段。

**Target**：Agent 页只进入动态渠道中心。

**Acceptance**：
- [ ] Agent 设置生产代码无非钉钉渠道 ID。
- [ ] 不再从 Agent 页创建静态渠道配置。

### BUG-CRA-06 · 遗留渠道配对文件

**Current**：Native 暴露无前端调用的 Telegram 专属 pairing 文件读写 command。

**Target**：删除死链；任何渠道配对都由当前 Runtime 自己的 Gateway/CLI 契约处理。

**Acceptance**：
- [ ] Native 生产代码无渠道专属 pairing 文件名。
- [ ] Tauri handler 不再暴露三个遗留 command。

### BUG-CRA-05 · 展示元数据

**Current**：名称、图标和 known 使用 JunQi 模板。

**Target**：使用 Runtime label/catalog；缺失时回退原始 ID，而不是模板。

**Acceptance**：
- [ ] `channelTemplates.ts` 删除。
- [ ] catalog 外配置明确显示为当前 Runtime 未识别。
