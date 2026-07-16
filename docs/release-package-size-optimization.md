# 桌面端发布包体积优化说明

## 目标

在不移除现有功能、且所有安装依赖保持国内网络可访问的前提下，降低每位用户实际需要下载的桌面安装包体积。

## 本次调整

- macOS 不再生成同时包含 ARM64 与 x64 的 universal 安装包，改为两个独立架构包。
- 自动更新清单按 `darwin-aarch64` 和 `darwin-x86_64` 分别指向对应更新包。
- Tauri updater 根据当前运行的 CPU 架构选择更新包，旧 universal 应用运行时同样会解析到实际架构。
- Rust 发布构建启用全程序 LTO、单代码生成单元、体积优先优化、符号剥离和 `panic=abort`。
- 移除仅用于发布版开发者工具的 Tauri `devtools` feature；开发构建的正常调试能力不受影响。
- Windows 安装包优先复用系统已有 WebView2，不再把约 127 MB 的 WebView2 离线安装器塞入主安装包。
- 安装包不再内置约 1.6–1.8 MB 的微软官方引导程序；缺失运行时的设备在安装时下载引导程序，再通过微软大陆 CDN 按需安装。
- 不发布 WebView2 离线完整包。
- 自动更新沿用轻量包；已经正常运行 JunQi 的设备必然具备可用 WebView2。
- ZIP 解压仅保留 Node.js 与 MinGit 官方制品实际使用的 Deflate/Stored 格式，不再编译 AES、BZip2、Deflate64、LZMA、XZ、Zstd 等未使用解码器。
- Windows 按 NSIS、中文 MSI、英文 MSI 分开上传；macOS 按 DMG 与 updater 分开上传，用户只下载对应用途的单个制品。

## 保留策略

- Windows 继续分别生成 x64 与 ARM64 安装包。
- WebView2 按需下载使用微软官方 `msedge.sf.dl.delivery.mp.microsoft.com` 分发链路，不写入第三方下载站。
- EXE、MSI、DMG 和自动更新压缩包仍按各自分发用途保留。

## 验收标准

- macOS ARM64 与 x64 分别生成 DMG 和 `.app.tar.gz`，不再生成 universal 包。
- `latest.json` 为两个 macOS 架构生成不同的下载地址和签名。
- Windows Release 不得嵌入 WebView2 引导程序或离线完整包。
- 发布版 Rust 二进制不包含调试符号和发布版开发者工具 feature。
- 完整前端、Rust、脚本测试和生产构建通过。

## 本地实测

同一台 Apple Silicon 主机、同一版本内容下对 ARM64 包进行对比：

| 产物 | 优化前 | 优化后 | 变化 |
| --- | ---: | ---: | ---: |
| 主二进制 | 31,687,200 字节 | 12,258,096 字节 | -61.3% |
| ARM64 DMG | 13,050,943 字节 | 7,521,325 字节 | -42.4% |

线上签名和封装可能带来少量字节差异，最终发布体积以 GitHub Actions 产物为准。
