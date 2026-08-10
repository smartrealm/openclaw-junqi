# 钉钉接入状态与授权引导规格

日期：2026-08-10

## 行为契约

1. 插件状态未完成读取时，界面只能显示正在核对，不得判断为未安装或未授权。
2. 插件安装成功不等于当前 Session 已加载工具；用户重启 Gateway 后，JunQi 必须等待新的已核验连接身份。
3. 新连接身份成立后，JunQi 自动刷新 Session、当前 Session 的 `tools.effective`、插件状态和 DWS 身份。
4. Native 运行时使用 DWS 官方浏览器扫码授权；Docker 使用官方设备码授权。
5. 当前 Agent 授权必须由一个工作台动作完成，使用 `config.get` 的有效快照和 `hash`，通过一次最小
   `config.patch` 同时更新 Agent 工具策略与插件 `allowedAgentIds`。
6. Agent 的非空 `tools.allow` 追加插件 ID；未设置 `allow` 时追加 `tools.alsoAllow`；空 `allow` 保留
   OpenClaw 当前非限制语义。
7. 全局或当前 Agent 策略明确 `deny` 时不得自动移除拒绝规则。
8. 当前 Agent 不是显式配置、配置结构未知、Gateway 未确认写入或重启后仍是旧连接时，流程失败关闭并显示原因。
9. 授权成功只以新连接的 `tools.effective` 和 DWS 结构化投影为准，不以按钮完成、进程退出或旧缓存推断。
10. 钉钉业务页的普通 Gateway 重启必须进入全局 `GatewayLifecycleCoordinator`；页面不得直接调用进程重启 IPC
    或底层进程观察服务。等待循环只能作为新连接身份门禁，不能替代主动重连。
11. Native DWS 安装必须使用当前 OpenClaw 所选 Node.js 与配套 npm CLI，并绑定其已核验的绝对 npm 全局
    prefix。无法取得 Node、npm 或 prefix 契约时失败关闭，不搜索或创建猜测位置。
12. DWS 安装完成必须在同一 Native 或 Docker runtime 内执行 `dws version --format json`；授权完成必须执行
    `dws auth status --format json`。命令不存在、退出失败、输出超限、非 JSON 或结构化失败均不得显示完成。
13. Native 核验得到的准确 npm `bin/dws.js` 绝对入口必须通过官方配置快照和 `baseHash` 最小写入插件
    `dwsPath`，插件通过当前 Gateway Node.js 直接执行，不得通过 Windows shell 或 `.cmd` 拼接参数；Docker 容器
    路径不得写入宿主配置。写入后必须通过统一 Gateway 生命周期重新核验连接和 Runtime Identity。
14. 接入检查、DWS 安装授权、Gateway 重连和身份投影的用户可见状态必须在简体中文、繁体中文和英文资源中保持
    同一键集合；原始子进程诊断不能替代本地化状态。

## 验收

- 插件探测进行中不会短暂出现“插件未就绪”或“Agent 未授权”。
- 重启按钮保持加载状态，直到全局 Gateway 生命周期确认新 connection ID、官方握手和 Runtime Identity 一致，随后页面自动更新；业务页不得复制连接轮询或超时判断。
- 当前 Agent 授权弹层不再要求用户进入 Advanced 编辑原始配置。
- Native 授权命令参数不包含 `--device`；Docker 授权命令仍包含 `--device`。
- 配置测试覆盖 `agents.list`、`agents.entries`、全局与 Agent 显式拒绝和隐式 Agent 边界。
