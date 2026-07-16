# 萌宠平台表面规格

## BUG-PS-01 · Windows 7 发行边界

**Current**：所有平台创建透明 Tauri WebView；当前 Windows 安装器依赖 WebView2。

**Target**：当前稳定发行通道支持 Windows 10+。不得以一个原生萌宠窗口掩盖 Win7 上
整个 WebView2 宿主已结束支持的事实。

**Acceptance**：
- [ ] Windows 支持范围在产品文档、安装前检测和错误提示中一致为 Windows 10+。
- [ ] Win7 不会被宣称为当前发行通道的兼容目标。
- [ ] 若批准旧版发行线，另立规格覆盖冻结 WebView2、全应用兼容测试和安全风险告知。

## BUG-PS-02 · macOS 像素格式归一化

**Current**：CoreGraphics 图像以默认字节序作为 BGRA 读取。

**Target**：先绘制到固定 sRGB / 32-bit BGRA bitmap context，再计算派生亮度和对比度。

**Acceptance**：
- [ ] 不依赖源 CGImage 的字节序猜测颜色通道。
- [ ] 宽色域与普通 sRGB 显示器都输出有效、有限的亮度读数。
- [ ] 不写入截图文件，不将像素经 IPC 发送到 WebView。

## BUG-PS-03 · 授权与用户控制

**Current**：权限拒绝后静默使用主题默认文字颜色。

**Target**：萌宠设置拥有动态对比度开关、能力状态和恢复入口；关闭时不调用桌面采样。

**Acceptance**：
- [ ] 用户可关闭动态桌面采样且立即停止后续采样。
- [ ] macOS 拒绝 Screen Recording 后，UI 提供明确但非阻塞的恢复入口。
- [ ] 不在后台定时任务中触发系统授权弹窗。
