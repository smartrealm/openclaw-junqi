# Provider/Model 可视化 + 环境检测 — 跨项目调研

> 调研日期：2026-07-02
> 目的：参考 ClawX、hexclaw-desktop、OpenClawInstaller 三个项目，在 junqi 中实现：
> 1. openclaw 供应商(provider)与模型(model)切换的可视化界面
> 2. 本地环境检测（openclaw 是否安装、版本、Node.js、git 等）以及各 OS 的安装指引
>
> 相关文件位置：本文档位于 `openclaw-junqi/.planning/analysis/`，避免每次重新分析。

---

## 一、参考项目概览

| 项目 | 框架 | 后端 | 定位 |
|------|------|------|------|
| **ClawX** | Electron + React | Node.js + `openclaw` npm 包 | openclaw 的桌面封装 |
| **hexclaw-desktop** | Tauri + Vue 3 | Go sidecar (`hexclaw serve`) | 自身即网关，与 openclaw 同源 |
| **OpenClawInstaller** | 纯 Bash 脚本 | openclaw CLI 安装+配置 | 跨平台一键安装器 |

---

## 二、Provider/Model 切换可视化

### 2.1 ClawX 方案（推荐参考）

**14 个 provider 静态注册表** — `electron/shared/providers/registry.ts`：

```ts
export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY', requiresApiKey: true,
    models: [{ id: 'claude-sonnet-4-6', cost: {...}, contextWindow: 200000 }, ...] },
  { id: 'openai', ... },
  { id: 'google', ... },
  { id: 'openrouter', ... },
  { id: 'ark', ... },
  { id: 'moonshot', ... },
  { id: 'moonshot-global', ... },
  { id: 'siliconflow', ... },
  { id: 'deepseek', ... },
  { id: 'minimax-portal', ... },
  { id: 'minimax-portal-cn', ... },
  { id: 'modelstudio', ... },
  { id: 'ollama', ... },
  { id: 'custom', ... },
];
```

每个 provider 定义：
- `id, name, icon, placeholder, requiresApiKey`
- `defaultModelId, modelIdPlaceholder`
- `showModelId, showBaseUrl`（控制 UI 字段显隐）
- `apiKeyUrl, docsUrl`（用户跳转获取 key）
- `isOAuth, scopes`（OAuth 流程）
- `models: [{ id, cost, contextWindow, capabilities }]`

**前端 store**（`src/stores/providers.ts`）：
- Zustand store：`accounts`, `vendors`, `defaultAccountId`
- 方法：`createAccount / updateAccount / removeAccount / setDefaultAccount / validateAccountApiKey`
- 同一 provider 可多个 account（如多 OpenAI key）

**UI**（`src/components/settings/ProvidersSettings.tsx`）：
- 列表 + 添加/编辑/删除
- API key 实时校验（点"测试连接"）
- OAuth 流程支持（MiniMax、OpenAI）

### 2.2 hexclaw-desktop 方案（双层 catalog）

**14 个 provider**（中国本土化）— `src/config/providers.ts`：

```
openai, deepseek, anthropic, gemini, qwen, ark, zhipu, kimi,
ernie, hunyuan, spark, minimax, ollama, custom
```

**双层模型架构**（`src/stores/model-catalog.ts`）：
```
Catalog (full list)  ←── /models API 拉取，cache 在 localStorage
   ↓
Enabled (curated)    ←── 用户勾选，写入 provider.models 配置
```

- 阈值 `AUTO_ENABLE_CATALOG_LIMIT = 10`：
  - ≤10 个模型 → 全部自动启用
  - >10 个 → 仅 catalog，用户在 `ModelManagerModal` 中挑选

**ModelManagerModal 功能**（`src/components/settings/ModelManagerModal.vue`）：
- 搜索框
- 按能力过滤（text/vision/audio/code/image_generation/video_generation）
- 厂商分组（OpenRouter `vendor/model` 格式解析）
- 新模型"蓝点"标记

### 2.3 OpenClawInstaller 方案（17 provider 配置菜单）

**配置菜单**（`config-menu.sh`）— 主菜单第 2 项「AI 模型配置」：

| # | Provider | 环境变量 | 默认模型 |
|---|----------|---------|---------|
| 1 | Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | `claude-sonnet-4-6` |
| 2 | OpenAI | `OPENAI_API_KEY`, `OPENAI_BASE_URL` | `gpt-5.1-codex` |
| 3 | DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| 4 | Moonshot/Kimi | `MOONSHOT_API_KEY` | `kimi-k2.5` |
| 5 | Google Gemini | `GOOGLE_API_KEY` | `gemini-3.1-pro-preview` |
| 6 | OpenRouter | `OPENROUTER_API_KEY` | `auto` |
| 7 | Groq | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| 8 | Mistral | `MISTRAL_API_KEY` | `mistral-large-latest` |
| 9 | Ollama | `OLLAMA_HOST`（无 key） | `llama3` |
| 10 | xAI | `XAI_API_KEY` | `grok-4` |
| 11 | Zai (GLM) | `ZAI_API_KEY` | `glm-5` |
| 12 | MiniMax | `MINIMAX_API_KEY` | `MiniMax-M2.5` |
| 13 | OpenCode | `OPENCODE_API_KEY` | `claude-opus-4-6` |
| 14 | Azure OpenAI | `OPENAI_API_KEY` + endpoint | `gpt-5.1-codex` |
| 15 | Gemini CLI | `GOOGLE_API_KEY` | `gemini-3.1-pro-preview` |
| 16 | Google Antigravity | `GOOGLE_API_KEY` | `gemini-3-pro-high` |
| 17 | Novita AI | `NOVITA_API_KEY` | `moonshotai/kimi-k2.5` |
| - | 自定义 | 任意 | 任意 |

写入路径：`~/.openclaw/openclaw.json` 的 `models.providers` 节点。

### 2.4 推荐实现方案（junqi）

**参考 ClawX 的注册表 + OpenClawInstaller 的 17 provider 清单**，在 junqi 中：

```
src/config/providers.ts        # 静态注册表
src/stores/providerStore.ts    # Zustand
src/pages/Settings/Providers/  # UI 页面
  ├─ ProviderCard.tsx
  ├─ AddProviderDialog.tsx
  ├─ ModelSelector.tsx
  └─ ApiKeyInput.tsx
```

**字段建议**（合并三者优势）：

```ts
interface ProviderDef {
  id: string;
  name: string;
  icon: string;          // Lucide icon name
  envVars: string[];     // ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']
  baseUrl?: string;
  requiresApiKey: boolean;
  defaultModel: string;
  availableModels: ModelInfo[];
  apiKeyUrl?: string;    // 跳转获取 key
  docsUrl?: string;
  isOAuth?: boolean;
}

interface ModelInfo {
  id: string;
  name?: string;
  contextWindow?: number;
  capabilities?: ('text' | 'vision' | 'audio' | 'code' | 'image_gen' | 'video_gen')[];
  cost?: { input: number; output: number };
}
```

---

## 三、本地环境检测

### 3.1 检测项清单

| 检测项 | ClawX | hexclaw-desktop | OpenClawInstaller |
|--------|-------|-----------------|-------------------|
| **openclaw 安装** | ✅ `isOpenClawPresent()` + `isOpenClawBuilt()` | ✅ Rust sidecar 检测 | ✅ `check_command openclaw` |
| **openclaw 版本** | ✅ 读 package.json | ❌ | ✅ `openclaw --version` |
| **Node.js 版本** | ✅ "always available" (Electron 内置) | ❌（不需要） | ✅ 最低 22.12.0，**双维度比较** major+minor |
| **git** | ❌ | ❌ | ✅ 检测 + 自动安装 |
| **OS 检测** | 隐式（process.platform） | 隐式 | ✅ macOS/Linux 分发识别 |
| **WSL** | ❌ | ❌ | ❌（仅 Git Bash/Cygwin 警告） |
| **sudo 维持** | ❌ | ❌ | ✅ `sudo -n` keepalive daemon |
| **低内存 Swap** | ❌ | ❌ | ✅ <4G 内存自动建 swapfile |
| **磁盘空间** | ❌ | ❌ | ❌ |
| **网络/代理** | ❌ | ✅ macOS `scutil --proxy` 注入 sidecar | ✅ 多镜像源 fallback |

### 3.2 OpenClawInstaller 的环境检测详解（最完整，可直接借鉴）

#### 3.2.1 Node.js 版本检测

```bash
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=12

node_major=$(node -v | sed 's/^v//' | cut -d'.' -f1)
node_minor=$(node -v | sed 's/^v//' | cut -d'.' -f2)

if [ "$node_major" -gt "$MIN_NODE_MAJOR" ] || \
   { [ "$node_major" -eq "$MIN_NODE_MAJOR" ] && \
     [ "$node_minor" -ge "$MIN_NODE_MINOR" ]; }; then
    log_info "Node.js 版本满足要求: $(node -v)"
    return 0
fi
```

**最低要求**：Node.js v22.12.0+（**注意是 LTS Iron/Iodine 22.x 最低小版本**）

#### 3.2.2 Git 检测 + 自动安装

```bash
install_git() {
    if ! check_command git; then
        case "$OS" in
            macos)   brew install git ;;
            ubuntu|debian)  sudo apt-get install -y git ;;
            centos|rhel|fedora)  sudo yum install -y git ;;
            arch|manjaro)  sudo pacman -S git --noconfirm ;;
        esac
    fi
    log_info "Git 版本: $(git --version)"
}
```

#### 3.2.3 OS 检测

```bash
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS=$ID  # 来自 /etc/os-release
        PACKAGE_MANAGER="apt|yum|dnf|pacman"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        PACKAGE_MANAGER="brew"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        OS="windows"  # 仅警告，不完整支持
    fi
}
```

**未检测 WSL**（junqi 可补强）。

#### 3.2.4 openclaw 已安装检测

```bash
if check_command openclaw; then
    current_version=$(openclaw --version 2>/dev/null || echo "unknown")
    log_warn "OpenClaw 已安装 (版本: $current_version)"
    if ! confirm "是否重新安装/更新？"; then
        init_openclaw_config
        return 0
    fi
fi
```

兼容别名：优先 `openclaw`，兜底 `claw`。

#### 3.2.5 ClawX 的 openclaw 检测（更细）

**文件**：`electron/utils/paths.ts`

```ts
// Prod: process.resourcesPath/openclaw
// Dev: node_modules/openclaw
getOpenClawDir(): string

// Returns {dir}/openclaw.mjs
getOpenClawEntryPath(): string

isOpenClawPresent(): boolean   // dir + package.json 都存在
isOpenClawBuilt(): boolean     // dist/ 存在

getOpenClawStatus(): {
  packageExists: boolean;
  isBuilt: boolean;
  entryPath: string;
  dir: string;
  version: string;            // 读 package.json
}
```

### 3.3 各 OS 安装流程

#### 3.3.1 macOS

| 步骤 | 命令 |
|------|------|
| Homebrew 安装 | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |
| Node.js | `brew install node@22 && brew link --overwrite node@22` |
| Git | `brew install git` |
| openclaw | `npm i -g openclaw` |
| 守护 | 写入 `~/Library/LaunchAgents/com.openclaw.agent.plist`（`RunAtLoad=true`, `KeepAlive=true`） |

#### 3.3.2 Linux

| 分发 | Node.js 安装 |
|------|------|
| Ubuntu/Debian | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt install -y nodejs` |
| CentOS/RHEL | `curl -fsSL https://rpm.nodesource.com/setup_22.x \| sudo bash -` |
| Fedora | `sudo dnf install -y nodejs` |
| Arch/Manjaro | `sudo pacman -S nodejs npm --noconfirm` |

守护：写入 `/tmp/openclaw.service`，`systemctl enable openclaw`。

#### 3.3.3 Windows (WSL)

**OpenClawInstaller 不完整支持**——仅检测到 Git Bash/Cygwin 时提示。

**hexclaw-desktop 方案**（更完整）：
- Windows 上需要 WSL2
- 端口冲突检测：`lsof -nP -iTCP:16060 -sTCP:LISTEN -t`（WSL 内）
- Windows 侧：`netstat -ano -p tcp`

#### 3.3.4 PATH 修改

写入顺序：

```bash
if [ -f "$HOME/.zshrc" ]; then   shell_rc="$HOME/.zshrc"      # macOS 默认
elif [ -f "$HOME/.bashrc" ]; then shell_rc="$HOME/.bashrc"     # Linux 默认
elif [ -f "$HOME/.bash_profile" ]; then shell_rc="$HOME/.bash_profile"
fi
echo "[ -f \"$env_file\" ] && source \"$env_file\"" >> "$shell_rc"
```

### 3.4 junqi 已有的相关代码

**文件**：`src-tauri/src/commands/gateway.rs`

| 函数 | 功能 |
|------|------|
| `resolve_openclaw_binary()` | 用 augmented PATH 找 openclaw（which/where） |
| `ConfigMetadata::load()` | 读 openclaw.json 的 port + env_vars |
| `is_gateway_serving(port)` | HTTP /healthz 探测 |
| `run_doctor()` | 执行 `openclaw doctor` |
| `augmented_path()` | 拼 PATH：node bin、openclaw prefix、~/.npm-global、~/.local/bin、asdf/mise shim |

**缺口**：
- 无 `node -v` 版本检查（junqi 用户跑在桌面端，但要求 Node 22.12+ 必备）
- 无 `git --version` 检查
- 无 WSL 检测
- 无 `openclaw --version` 单独检查（仅看是否存在于 PATH）

### 3.5 推荐的 junqi 环境检测实现

**新增 Rust 模块** `src-tauri/src/commands/environment.rs`：

```rust
#[derive(Serialize)]
pub struct EnvironmentReport {
    pub os: OsInfo,
    pub openclaw: OpenClawStatus,
    pub node: Option<ToolStatus>,
    pub git: Option<ToolStatus>,
    pub wsl: bool,
    pub disk_free_mb: u64,
    pub warnings: Vec<String>,
}

#[derive(Serialize)]
pub struct OpenClawStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub binary_path: Option<String>,
    pub doctor_output: Option<String>,
}

#[derive(Serialize)]
pub struct ToolStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub meets_minimum: bool,
}

#[derive(Serialize)]
pub struct OsInfo {
    pub family: String,    // "macos" | "linux" | "windows"
    pub distro: Option<String>,  // "ubuntu", "fedora"...
    pub arch: String,
    pub is_wsl: bool,
    pub is_root: bool,
}

#[tauri::command]
pub async fn check_environment() -> EnvironmentReport { ... }

#[tauri::command]
pub async fn get_install_instructions() -> InstallInstructions { ... }
```

**前端页面** `src/pages/Setup/EnvironmentCheck.tsx`：

- 显示 4 个 check 卡片：openclaw / Node.js / git / 磁盘空间
- 每张卡片三个状态：✅ 满足 / ⚠️ 警告 / ❌ 缺失
- 缺失项展开"如何安装"分步骤指引（按 OS 分支）

---

## 四、openclaw doctor 集成

### 4.1 现状（junqi）

`gateway.rs::run_doctor()` 已实现：

```rust
let mut cmd = tokio::process::Command::new(&openclaw);
cmd.arg("doctor")
   .env("PATH", &augmented_path())
   .env("OPENCLAW_STATE_DIR", ...)
   .env("OPENCLAW_CONFIG_PATH", ...);
```

### 4.2 现状（OpenClawInstaller）

升级链路（`config-menu.sh:6522-6620`）：

```bash
openclaw update --restart            # 官方推荐
  ↓ 失败则回退
npm update -g openclaw
  ↓
yes|openclaw doctor --fix             # 自动修复
  ↓
openclaw plugins update --all
```

### 4.3 ClawX 现状

`openclaw-doctor.ts`：

```ts
const OPENCLAW_DOCTOR_ARGS = ['doctor'];
const OPENCLAW_DOCTOR_FIX_ARGS = ['doctor', '--fix', '--yes', '--non-interactive'];

// utilityProcess.fork()，60s timeout，10MB 输出上限
export async function runOpenClawDoctor(): Promise<OpenClawDoctorResult>
export async function runOpenClawDoctorFix(): Promise<OpenClawDoctorResult>
```

UI 位置：`src/pages/Settings/index.tsx`，两个按钮「Run Diagnostics / Fix Issues」，展示 exitCode + duration + stdout + stderr + 复制按钮。

### 4.4 建议

junqi 已有 `run_doctor` Rust 命令；前端需：
- 在 `/settings` 页面增加「Run Diagnostics / Fix Issues」按钮
- 调用 `invoke('run_doctor')` 与 `invoke('run_doctor_fix')`（后者新增）
- 复用 `OfflineOverlay` 风格展示输出

---

## 五、实施路线（待用户确认）

### Phase A：环境检测（最优先）

1. 新增 `src-tauri/src/commands/environment.rs`
2. 实现 `check_environment()` / `get_install_instructions()`
3. 前端 `src/pages/Setup/EnvironmentCheck.tsx`（Setup 流程第 1 步）
4. 接入 SetupPage（已有），gate 在「环境全部满足」

### Phase B：Provider/Model 可视化

1. 新增 `src/config/providers.ts`（17 provider 静态注册表）
2. 新增 `src/stores/providerStore.ts`（Zustand）
3. 新增 `src/pages/Settings/Providers/index.tsx`
4. 增加 `AddProviderDialog / ModelSelector / ApiKeyInput` 组件
5. 接入 `gateway.rs::ensure_config_with_token` 路径：把 user 选择的 provider 写入 `models.providers` 节点

### Phase C：openclaw doctor 增强

1. 新增 Rust 命令 `run_doctor_fix()`
2. 前端 Settings 页面增加「Fix Issues」按钮
3. 复用 `OfflineOverlay` 风格展示输出

---

## 六、文件引用索引

### ClawX
- `electron/utils/paths.ts` — openclaw 状态检测
- `electron/utils/openclaw-doctor.ts` — doctor 执行
- `electron/shared/providers/registry.ts` — 14 provider 静态注册
- `src/pages/Setup/index.tsx` — 4 步 onboarding
- `src/components/settings/ProvidersSettings.tsx` — UI
- `src/stores/providers.ts` — Zustand store
- `src/pages/Settings/index.tsx` — doctor UI

### hexclaw-desktop
- `src/config/providers.ts` — 14 provider 配置
- `src/components/common/ProviderSelect.vue` — 选择器组件
- `src/stores/model-catalog.ts` — 双层 catalog 架构
- `src/components/settings/ModelManagerModal.vue` — 模型管理
- `src-tauri/src/sidecar.rs` — sidecar 进程管理 + 端口冲突检测

### OpenClawInstaller
- `install.sh` — 3004 行主安装脚本
  - L73-74 Node 最低版本常量
  - L482-514 OS 检测
  - L598-609 Node 版本比较
  - L639-659 Git 安装
  - L768-938 Swap 自动管理
  - L953-997 npm 低内存回退
  - L1076-1083 重复安装检测
  - L1909-1931 PATH 写入
  - L2074-2548 17 provider 配置
- `config-menu.sh` — 7343 行配置菜单
  - L4594-4689 飞书特殊处理
  - L6264-6375 AI 自动修复
  - L6522-6620 升级链路
  - L7263-7311 主菜单
- `scripts/preflight-check.sh` — 63 行发布前校验
- `docs/official-compatibility-checklist.md` — 17 项兼容性清单
- `docs/channels-configuration-guide.md` — 渠道配置

### junqi
- `src-tauri/src/commands/gateway.rs` — 已有 `augmented_path / resolve_openclaw_binary / run_doctor / is_gateway_serving`
- 待新增：`src-tauri/src/commands/environment.rs`
- 待新增：`src/config/providers.ts` 与 `src/stores/providerStore.ts`
- 待新增：`src/pages/Setup/EnvironmentCheck.tsx` 与 `src/pages/Settings/Providers/`
