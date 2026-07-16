# 萌宠平台表面规格

## BUG-PS-01 · Windows 7 原生分层表面

**Current**：所有平台创建透明 Tauri WebView。

**Target**：通过 `PetSurface` 工厂选择平台后端。Windows 7 仅创建原生 layered window；
它使用预乘 alpha 的 BGRA 帧、alpha hit-test、统一的拖拽/菜单/可见性命令和状态订阅。

**Acceptance**：
- [ ] Win7 不创建透明 WebView 萌宠窗口。
- [ ] 萌宠透明区域不出现黑色矩形，点击透明像素可穿透桌面。
- [ ] 移动、右键菜单、显示/隐藏、主窗口聚焦与当前 WebView 后端行为一致。
- [ ] Windows 7 真机或受支持 VM 截图验证通过。

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
