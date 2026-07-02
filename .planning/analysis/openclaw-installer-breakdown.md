# OpenClawInstaller 项目深度拆解

> 调研日期：2026-07-02
> 调研对象：`/Users/wei/DevTool/project/mine/gui/OpenClawInstaller`（独立 Bash 脚本项目）
> 目的：把跨 OS 安装 openclaw 的完整流程抽象出来，供 junqi 在桌面端实现等价能力

---

## 一、项目概览

| 属性 | 值 |
|------|-----|
| 项目名 | OpenClawInstaller（大圣之怒傻瓜 Openclaw 安装&配置助手） |
| 定位 | openclaw 的非官方安装增强脚本（包装官方安装器 + 交互式配置） |
| 官方源仓库 | `leecyno1/auto-install-Openclaw` |
| 主脚本 | `install.sh`（3004 行）+ `config-menu.sh`（7343 行） |
| 一键安装 | `curl -fsSL raw.githubusercontent.com/leecyno1/auto-install-Openclaw/main/install.sh \| bash` |
| 总代码量 | ~10300 行 bash |

---

## 二、目录结构

```
OpenClawInstaller/
├── install.sh                  # 主入口：环境检测 + 安装 + 配置向导
├── config-menu.sh              # 独立配置菜单（可重复运行）
├── scripts/
│   └── preflight-check.sh      # 发布前自动化校验
├── docs/
│   ├── official-compatibility-checklist.md   # 17 项官方1:1兼容性清单
│   ├── feishu-setup.md                      # 飞书配置详细指南
│   └── channels-configuration-guide.md      # 渠道配置总览
├── examples/                   # 配置文件示例
├── skills/                     # 渠道文档/Skill 注入
├── docker-compose.yml
├── Dockerfile
├── docker-entrypoint.sh
└── README.md
```

---

## 三、install.sh 主流程（main 函数，L2914-3003）

```
main()
  ├── parse_args() / normalize_install_options()
  ├── print_banner() + print_install_plan()
  ├── confirm() 确认安装
  ├── detect_os()                     # OS + 分发识别
  ├── check_root()                    # EUID=0 警告
  ├── ensure_sudo_privileges()        # 启动 sudo -n keepalive
  ├── install_dependencies()          # git + nodejs + curl/wget/jq
  ├── create_directories()            # ~/.openclaw/{logs,data,skills,backups}
  ├── install_channel_assets()        # 注入渠道配置文档 + Skill.md
  ├── install_openclaw()              # 核心：委托官方安装器 + 低内存兼容
  ├── run_onboard_wizard()            # 交互式配置向导
  ├── apply_default_security_baseline()
  ├── setup_daemon()                  # launchd / systemd
  ├── print_success()
  ├── confirm → start_openclaw_service()
  └── confirm → run_config_menu()
```

---

## 四、环境检测（最完整，可直接借鉴）

### 4.1 Node.js 版本（双维度比较）

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

**最低要求**：**Node.js v22.12.0+**（LTS Iron 22.12 或 J/Iodine 22.x 更高小版本）

### 4.2 Git 检测 + 按 OS 自动安装

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

### 4.3 OS 检测

```bash
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS=$ID  # 来自 /etc/os-release
        PACKAGE_MANAGER="apt|yum|dnf|pacman"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        PACKAGE_MANAGER="brew"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        OS="windows"   # 仅警告，不完整支持
    fi
}
```

**注意**：
- 未检测 WSL（Windows 用户需自行用 WSL2）
- 分发识别依赖 `/etc/os-release`

### 4.4 openclaw 已安装检测

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

### 4.5 sudo 维持（防中途过期）

```bash
ensure_sudo_privileges() {
    # 启动后台 sudo -n keepalive daemon
    # 防止 apt-get/yum 长时间运行时 sudo 凭证过期
}
```

### 4.6 低内存 Swap 自动管理（亮点功能）

```bash
# 阈值: 内存 < 4096MB 且 Swap < 推荐目标 → 低内存
is_low_memory_linux()    # 阈值 <4G
get_recommended_swap_mb()  # <2G → 4G swap; 2G~4G → 2G swap

# 自动创建/启用 swapfile（可选持久化到 /etc/fstab）
create_and_enable_swapfile()
ensure_swap_for_install()
```

### 4.7 npm OOM 自动回退

```bash
npm_install_openclaw_with_fallback() {
    # 先正常 npm i -g openclaw
    # 若 is_oom_like_failure() (exit 137/143 或日志含 OOM) → 切低内存模式重试
}

is_oom_like_failure() {
    [[ $exit_code -eq 137 || $exit_code -eq 143 ]] || \
    grep -qiE 'out of memory|killed|oom' <<< "$log"
}
```

### 4.8 网络下载多镜像 fallback

```bash
CURL_CONNECT_TIMEOUT="${OPENCLAW_CURL_CONNECT_TIMEOUT:-8}"
CURL_MAX_TIME="${OPENCLAW_CURL_MAX_TIME:-30}"

download_with_fallback() {
    local output_path="$1"; shift
    for url in "$@"; do
        if curl -fsSL --proto '=https' --tlsv1.2 \
           --connect-timeout "$CURL_CONNECT_TIMEOUT" \
           --max-time "$CURL_MAX_TIME" "$url" -o "$output_path"; then
            return 0
        fi
    done
    return 1
}
```

下载源优先级：
1. 官方源 `https://openclaw.ai/install.sh`
2. 用户指定 `$OFFICIAL_INSTALL_MIRROR_URL`
3. 内置镜像 `https://mirror.ghproxy.com/...`

---

## 五、各 OS 安装流程

### 5.1 macOS

| 步骤 | 命令 |
|------|------|
| 1. Homebrew 安装 | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |
| 2. Node.js | `brew install node@22 && brew link --overwrite node@22` |
| 3. Git | `brew install git` |
| 4. openclaw | 委托官方安装器 `openclaw.ai/install.sh` |
| 5. 守护进程 | 写入 `~/Library/LaunchAgents/com.openclaw.agent.plist`<br>`RunAtLoad=true`, `KeepAlive=true` |

### 5.2 Linux

| 分发 | Node.js 安装命令 |
|------|------|
| Ubuntu/Debian | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash -`<br>`sudo apt install -y nodejs` |
| CentOS/RHEL | `curl -fsSL https://rpm.nodesource.com/setup_22.x \| sudo bash -` |
| Fedora | `sudo dnf install -y nodejs` |
| Arch/Manjaro | `sudo pacman -S nodejs npm --noconfirm` |

守护：写入 `/tmp/openclaw.service`，`systemctl enable openclaw`

### 5.3 Windows (WSL)

**不完整支持** — 仅在 OSTYPE=msys/cygwin 时设置 OS=windows 并报错退出。

```bash
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    OS="windows"
    log_info "检测到 Windows 系统 (Git Bash/Cygwin)"
    # 实际报错退出，提示用 WSL
fi
```

**junqi 应补强 WSL 检测**。

### 5.4 PATH 写入 shell rc

```bash
shell_rc=""
if [ -f "$HOME/.zshrc" ]; then   shell_rc="$HOME/.zshrc"      # macOS 默认
elif [ -f "$HOME/.bashrc" ]; then shell_rc="$HOME/.bashrc"     # Linux 默认
elif [ -f "$HOME/.bash_profile" ]; then shell_rc="$HOME/.bash_profile"
fi
echo "[ -f \"$env_file\" ] && source \"$env_file\"" >> "$shell_rc"
```

---

## 六、17 个 AI Provider（详细清单）

| # | Provider | 环境变量 | 默认模型 | 备注 |
|---|----------|---------|---------|------|
| 1 | Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | `claude-sonnet-4-6` | |
| 2 | OpenAI | `OPENAI_API_KEY`, `OPENAI_BASE_URL` | `gpt-5.1-codex` | |
| 3 | DeepSeek | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` | `deepseek-chat` | |
| 4 | Moonshot/Kimi | `MOONSHOT_API_KEY`, `MOONSHOT_BASE_URL` | `kimi-k2.5` | |
| 5 | Google Gemini | `GOOGLE_API_KEY` | `gemini-3.1-pro-preview` | |
| 6 | OpenRouter | `OPENROUTER_API_KEY` | `auto` | 自动选择最优 |
| 7 | Groq | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | |
| 8 | Mistral | `MISTRAL_API_KEY` | `mistral-large-latest` | |
| 9 | Ollama | `OLLAMA_HOST`（无 key） | `llama3` | 本地推理 |
| 10 | xAI | `XAI_API_KEY` | `grok-4` | |
| 11 | Zai (GLM) | `ZAI_API_KEY` | `glm-5` | 智谱 |
| 12 | MiniMax | `MINIMAX_API_KEY` | `MiniMax-M2.5` | |
| 13 | OpenCode | `OPENCODE_API_KEY` | `claude-opus-4-6` | |
| 14 | Azure OpenAI | `OPENAI_API_KEY` + endpoint | `gpt-5.1-codex` | 需额外 endpoint 配置 |
| 15 | Gemini CLI | `GOOGLE_API_KEY` | `gemini-3.1-pro-preview` | |
| 16 | Google Antigravity | `GOOGLE_API_KEY` | `gemini-3-pro-high` | |
| 17 | Novita AI | `NOVITA_API_KEY` | `moonshotai/kimi-k2.5` | |
| - | 自定义 | 任意 | 任意 | 支持自定义 BASE_URL + API_TYPE (openai-responses / openai-completions) |

**写入路径**：`~/.openclaw/openclaw.json` 的 `models.providers` 节点。

---

## 七、配置菜单 config-menu.sh（7343 行）

### 7.1 主菜单（L7263-7311）

```
[1] 系统状态        - show_status()
[2] AI 模型配置     - config_ai_model()
[3] 消息渠道配置     - config_channels()
[4] 身份与个性配置   - config_identity()
[5] 安全设置        - config_security()
[6] 服务管理        - manage_service()
[7] 快速测试        - quick_test_menu()
[8] 高级设置        - advanced_settings()
[9] 查看当前配置     - view_config()
```

### 7.2 高级设置子菜单（L6641）

```
[1] 编辑环境变量
[2] 备份配置
[3] 恢复配置
[4] 重置配置
[5] 清理日志
[6] 更新 OpenClaw
[7] 卸载 OpenClaw
[8] AI 自动修复 OpenClaw   ← ai_auto_fix_menu()
```

### 7.3 AI 自动修复（L6264-6375，亮点功能）

```bash
ensure_auto_fix_openclaw_ready()
  # git clone leecyno1/auto-fix-openclaw → ~/.openclaw/tools/auto-fix-openclaw

check_codex_ready()
  # 检测 codex CLI 是否已安装 + 已登录

choose_auto_fix_repair_provider()
  # 选择 Codex 或 ClaudeCode 作为修复引擎

run_auto_fix_provider_repair()
  # 调用 auto-fix-openclaw repair-now --provider codex/claudecode
```

### 7.4 升级链路（L6522-6620）

```bash
openclaw update --restart              # 官方推荐
  ↓ 失败回退
npm update -g openclaw
  ↓
openclaw doctor --non-interactive      # 或 yes|openclaw doctor --fix
  ↓
openclaw plugins update --all
```

### 7.5 飞书特殊处理（L4594-4689）

飞书是**唯一被特殊对待**的渠道：

- 仅使用**官方插件** `@openclaw/feishu`（L109 写死）
- 安装前**强制清理**同名社区插件（L4599-4603）
- 配置写入官方推荐路径 `channels.feishu.accounts.main.appId/appSecret`（L4661-4680）
- 配置完成后 `openclaw plugins install "$FEISHU_PLUGIN_OFFICIAL" --pin`（L4616）

### 7.6 兼容双命令（L488-528）

```bash
# openclaw 为主，claw 为兼容别名
# 自动生成 openclaw shim 指向 claw 二进制
generate_openclaw_shim() {
    cat > "$HOME/.local/bin/openclaw" <<EOF
#!/bin/bash
exec claw "\$@"
EOF
    chmod +x "$HOME/.local/bin/openclaw"
}
```

---

## 八、错误处理机制

| 机制 | 实现位置 | 说明 |
|------|---------|------|
| `set -e` | install.sh:19 | 全局命令失败即退出 |
| `run_step_with_auto_fix()` | install.sh:204-230 | 一步失败→自动修复→重试一次 |
| `run_auto_fix_once()` | install.sh:155-202 | `openclaw doctor --fix` 或 `npm cache verify` |
| `npm_install_openclaw_with_fallback()` | install.sh:953-997 | OOM 检测→低内存模式重试 |
| `is_oom_like_failure()` | install.sh:940-951 | exit 137/143 或日志含 OOM 关键字 |

**无完整回滚机制** — 配置备份在 `~/.openclaw/backups/`，但安装本身不回滚。

---

## 九、Docker 支持

### 9.1 Dockerfile（56 行）

```dockerfile
FROM node:22-alpine
RUN npm install -g openclaw@latest
COPY docker-entrypoint.sh /
EXPOSE 18789
ENTRYPOINT ["/docker-entrypoint.sh"]
```

### 9.2 docker-compose.yml

```yaml
ports: ["18789:18789"]
volumes: ["~/.openclaw:/root/.openclaw"]  # 宿主机配置透传
# 可选 Ollama 服务（注释掉）
```

### 9.3 docker-entrypoint.sh（53 行）

```bash
# 初始化 ~/.openclaw/{logs,data,skills,backups}
# 创建默认 openclaw.json (channels/plugins skeleton) 和 env 模板
# exec "$@" 透传启动命令
```

---

## 十、文档资产

| 文件 | 行数 | 内容 |
|------|------|------|
| `README.md` | 527 | 完整使用指南、功能介绍、多渠道配置步骤 |
| `docs/official-compatibility-checklist.md` | - | 17 项官方1:1兼容性对照清单（2026-03-12） |
| `docs/feishu-setup.md` | - | 飞书配置详细指南（含权限 scopes JSON、事件订阅长连接） |
| `docs/channels-configuration-guide.md` | - | 全渠道配置总览（官方+社区插件列表、必填字段） |

---

## 十一、关键代码路径索引

| 功能 | 文件:行号 |
|------|----------|
| TTY 输入解析 (curl\|bash 兼容) | install.sh:23-37, config-menu.sh:14-43 |
| Node 版本双维度检测 | install.sh:73-74, 598-609 |
| 官方安装器委托 | install.sh:693-729 `install_openclaw_via_official()` |
| openclaw/claw 双命令兼容 | install.sh:999-1034, config-menu.sh:488-528 |
| openclaw shim 生成 | install.sh:1151-1161 |
| 低内存 Swap 自动管理 | install.sh:768-938 |
| npm 低内存回退安装 | install.sh:953-997 |
| 环境变量写入 shell rc | install.sh:1909-1931 |
| 自定义 Provider 配置 | install.sh:1638-1907 `configure_custom_provider()` |
| MiniMax 专属 provider 注入 | install.sh:1353-1453 `ensure_minimax_provider_config()` |
| 17 Provider 配置菜单 | install.sh:2074-2548 |
| AI 自动修复 (Codex/ClaudeCode) | config-menu.sh:6264-6375 |
| 飞书官方插件安装 | config-menu.sh:4594-4637 |
| 升级链路 (update→doctor→plugins) | config-menu.sh:6522-6620 |
| 主菜单 | config-menu.sh:7263-7311 |
| preflight 检查 | scripts/preflight-check.sh:1-63 |

---

## 十二、对 junqi 的可借鉴要点

### 12.1 立即可用的检测逻辑

| 检测项 | 借鉴方式 |
|--------|---------|
| **Node.js 双维度版本比较** | 直接移植 `install.sh:598-609` |
| **OS + 分发识别** | 移植 `detect_os()`，补 WSL 检测 |
| **openclaw --version** | 移植 `check_command openclaw` |
| **git --version** | 移植 `install_git()` |
| **npm 路径解析** | 复用现有 `augmented_path()` |

### 12.2 桌面端不需要的逻辑

| 不需要 | 原因 |
|--------|------|
| `sudo -n` keepalive | 桌面端不需要 sudo（用户级别安装） |
| Homebrew 自动安装 | 桌面端有自己的 PATH 拼接 |
| launchd/systemd 守护 | 桌面端由 Rust 后台进程管理 |
| swapfile 自动管理 | 桌面端用户自己保证 |
| `--fix` 自动修复 | 桌面端用户手动确认修复 |

### 12.3 可选的桌面端增强

| 增强 | 说明 |
|------|------|
| WSL 检测 | `grep -q microsoft /proc/version` 或 `WSL_INTEROP` env |
| 磁盘空间检测 | `df -m $HOME` |
| 网络代理检测 | `scutil --proxy` (macOS) / `gsettings get org.gnome.system.proxy` (Linux) |
| 平台架构 | `uname -m` (arm64/x64) |

---

## 十三、对照表：OpenClawInstaller vs junqi 现状

| 能力 | OpenClawInstaller | junqi 现状 | 差距 |
|------|------------------|-----------|------|
| Node.js 版本检查 | ✅ 22.12+ | ❌ | **需新增** |
| git 检查 | ✅ 自动安装 | ❌ | **需新增** |
| OS 检测 | ✅ 全平台 | ⚠️ 仅 process.platform | **需补 WSL** |
| openclaw 二进制解析 | ✅ which + 兼容 claw | ✅ `resolve_openclaw_binary` | 持平 |
| openclaw 版本读取 | ✅ `openclaw --version` | ❌ | **需新增** |
| openclaw doctor | ✅ 包装并调用 | ✅ `run_doctor` Rust 命令 | 持平 |
| doctor --fix | ✅ 自动修复 | ❌ | **可新增 `run_doctor_fix`** |
| Provider 切换 | ✅ 17 个 | ⚠️ 通过 `env.vars` 注入 | **需 UI 可视化** |
| Model 切换 | ✅ 配置菜单 | ❌ | **需 UI 可视化** |
| 守护进程 | ✅ launchd/systemd | ✅ Rust 后台进程 | 持平 |
| 自定义 Provider | ✅ BASE_URL + API_TYPE | ⚠️ 通过 `env.vars` | **需 UI** |
| AI 自动修复 | ✅ Codex/ClaudeCode | ❌ | 不需要 |

---

## 十四、建议实施顺序

### Phase 1：环境检测（核心，缺则安装无法继续）

1. 新增 `src-tauri/src/commands/environment.rs`
2. 实现 `check_environment()` 返回 `EnvironmentReport`
3. 实现 `get_install_instructions()` 按 OS 返回分步指引
4. 前端 `src/pages/Setup/EnvironmentCheck.tsx`
5. 接入 SetupPage 作为第 1 步

### Phase 2：Provider/Model 可视化

1. 新增 `src/config/providers.ts`（17 provider 静态注册表）
2. 新增 `src/stores/providerStore.ts`（Zustand）
3. 新增 `src/pages/Settings/Providers/index.tsx`
4. 组件：`ProviderCard / AddProviderDialog / ModelSelector / ApiKeyInput`
5. 写入 `~/.openclaw/openclaw.json` 的 `models.providers` 节点

### Phase 3：doctor 增强

1. 新增 Rust 命令 `run_doctor_fix()`
2. 前端 Settings 页面增加「Fix Issues」按钮

### Phase 4：自定义 Provider

1. UI 允许用户输入 BASE_URL + API_TYPE + 任意模型
2. 写入 `models.providers.custom`
