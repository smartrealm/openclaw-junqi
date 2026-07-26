# JunQi Desktop Windows 安装阶段全量复审

日期：2026-07-24

## 审查范围

从架构匹配安装包到 Native/Docker runtime 准备完成：

```text
NSIS / updater architecture
→ platform/runtime capability
→ storage/runtime selection transaction
→ Node/npm detection and repair
→ Git detection and fallback
→ OpenClaw detection/install/promotion
→ Docker image/container contract
→ Gateway startup and final probe
```

本次同时复核等待时间、复用、下载源、摘要、取消、事务回滚与 x86 Native-only 行为。代码和自动化通过不等于 Windows 真机验收。

## 结论

- 安装链的安全事务、取消、摘要、复用和 Gateway 门禁总体成立。
- Node release index 已采用 staggered concurrent race；checksum authority 并发解析。
- npm 使用已有 cache，registry fallback 不改写用户 npm 配置。
- Docker 镜像与容器按完整 managed contract 复用。
- 本次发现并修复 3 个安装阶段缺口。

## 已修复

### BUG-IU-11 · MEDIUM — Node/Git 下载成功后没有跨重试复用

**位置**：`src-tauri/src/commands/setup.rs`

**问题**：Node ZIP/MSI 与 Git ZIP/installer 下载到 UUID 临时目录，事务结束即删除。安装重试或修复会再次下载完整资产，与“最短安全等待”目标不符。

**修复**：

- 下载缓存位于稳定 app config 目录；
- key 绑定 publisher/authority SHA-256 与原文件名；
- 每次使用前重新流式计算 SHA-256；
- 错误、空文件或摘要不匹配时删除并重新下载；
- 下载成功且摘要通过后原子发布缓存；
- 缓存异常只降级为重新下载，不破坏安装事务。

**验收**：源码回归测试覆盖 cache path、使用前摘要复核及成功后持久化。

### BUG-IU-12 · CRITICAL — Windows x86 缺 Git 时仍进入不存在的 full installer 路径

**位置**：

- `src-tauri/src/commands/setup.rs`
- `src-tauri/src/commands/system.rs`
- `src-tauri/src/paths.rs`

**问题**：runtime policy 正确声明 x86 没有完整 Git installer，manifest 也只有 x86 MinGit；但默认 `install_git_impl_inner()` 仍调用 `install_windows_system_git()`，最终请求不存在的 x86 installer manifest entry。OpenClaw 只有在 npm 明确返回缺 Git 后才触发此链，因此静态架构映射测试没有暴露真实失败。

**影响**：真实 32 位 Windows 在 OpenClaw 安装需要 Git 时会失败，Native-only 首次启动链无法完成。

**修复**：

- Windows x86 缺 Git 时安装 publisher-digest 固定的 32-bit MinGit；
- 安装到稳定 JunQi-owned、架构隔离目录；
- `check_git()` 在 PATH 前复用该 fallback；
- 后续首次启动/重试不重复下载或安装；
- x64/ARM64 仍保留 full installer 路径。

**验收**：源码契约测试覆盖 x86 install 与 warm reuse 两端。

### BUG-IU-13 · MEDIUM — Windows x86 UI 把能力不支持误报为“未检测到 Docker”

**位置**：

- `src-tauri/src/commands/docker.rs`
- `src/api/tauri-commands.ts`
- `src/hooks/useSetupFlow.ts`
- `src/pages/SetupPage.tsx`
- 四种 locale

**问题**：后端虽然在 x86 立即跳过 Docker 检测，但返回值和普通 CLI 缺失相同，UI 显示“未检测到 Docker”，会让用户误以为安装 Docker 后可以选择该模式。

**修复**：新增非敏感 capability `unsupported_reason`；Windows x86 显示“仅支持 Native，不会检测或安装 Docker”，并继续自动回退 Native。

## 已核对但未改动

- 架构安装包与 updater：x86/x64/ARM64 独立 NSIS 和 updater key；
- Node x86：release catalog 必须实际存在 `win-x86-zip` / `win-x86-msi` 才会选中版本；
- npm：与 selected Node 形成同一 runtime contract；
- OpenClaw：staged install、payload validation、promotion marker 和恢复存在；
- Docker：x86 后端早退，不执行 CLI/daemon/image/container 探测；
- 下载：每个来源、总事务和 idle 均有超时，下载时同步计算摘要；
- 安装取消：Node/Git operation identity 与 process cleanup 已门禁；
- Gateway：安装完成不是 Ready，仍需 selected Gateway probe。

## 剩余验证边界

以下不能由当前 macOS 环境证明：

- `i686-pc-windows-msvc` CI 实际编译和测试结果；
- i686 NSIS、x86 WebView2 bootstrap；
- 真实 Windows x86 的 Node 22/npm/OpenClaw 依赖兼容性；
- Windows Credential Manager、UAC、Gateway/Wizard/model probe；
- 冷安装和 warm reuse 的真实耗时；
- updater、升级和卸载。

只有上述真实环境矩阵完成后，才可宣称 Windows 32 位正式可用。