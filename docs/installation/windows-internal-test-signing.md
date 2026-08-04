# Windows 内部测试签名流程

## 目的和边界

本流程用于 JunQi 团队控制的 Windows 测试设备，为内部构建提供可验证的 Authenticode 身份。它不建立公共 Windows 信任，不是正式发布方案，也不能向普通用户宣称发布者已由第三方认证。

Microsoft 的 Smart App Control 官方契约要求应用由 Windows Trusted Root Program 中的 CA 所签发证书签名。手动导入 JunQi 自签证书不满足这项公共 CA 要求，因此本流程不能保证放行截图中的 Smart App Control 拦截。它只适用于 Smart App Control 已关闭、处于评估状态，或由组织应用控制策略明确管理的专用测试设备。

内部测试证书必须满足以下边界：

- 私钥 PFX 只保存在专用签名机，不发送给测试人员，不提交仓库；
- 测试人员只接收不含私钥的 CER、公钥 SHA-256 和已签名安装包；
- 证书由测试人员在安装 JunQi 前独立确认并安装；
- JunQi 安装器不静默安装根证书，也不要求关闭 Smart App Control；
- 信任范围默认仅为当前 Windows 用户；
- 测试结束后按 thumbprint 删除证书；
- 面向不受团队管理的用户时，改用公共 CA 代码签名或受信任商店分发。

## 为什么必须先手动安装证书

自签名证书没有公共 CA 信任链。测试人员明确将公钥证书加入当前用户的 `Root` 和 `TrustedPublisher` 存储后，Windows Authenticode 可以验证这一内部身份；这不等于 Smart App Control 会把它视为 Windows Trusted Root Program 的公共 CA 签名。

这个动作不能藏在 NSIS 安装器里。安装器若能在未取得信任前安装自己的根证书，会破坏 Windows 的发布者身份边界。因此分发顺序是：

1. 测试负责人通过独立渠道提供 CER 文件及其 SHA-256；
2. 测试人员核对 SHA-256，并运行证书安装脚本；
3. Windows 显示证书主体、thumbprint 和有效期；
4. 测试人员输入固定确认语句后，仅为当前用户建立信任；
5. 测试人员再运行已签名 NSIS 安装包；
6. 测试结束后使用 thumbprint 删除测试证书。

这不是普通用户的一键安装流程，而是受控内部测试流程。

## 签名机准备

要求：

- Windows 10 或 Windows 11；
- Visual Studio Build Tools 和 Windows SDK；脚本会从 `PATH`、Windows Kits 注册表及标准 SDK 目录定位 `signtool.exe`；
- 仓库锁定的 Node.js、pnpm 与 Rust 工具链；
- 专用签名机或受控 Windows VM；
- `.artifacts/` 不被同步到公开位置。

### 1. 生成内部证书

在仓库根目录打开 PowerShell：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-internal-signing\New-JunQiInternalTestCertificate.ps1
```

脚本要求显式输入：

```text
CREATE JUNQI TEST CERTIFICATE
```

随后输入 PFX 强密码。默认输出到：

```text
.artifacts\windows-internal-signing\junqi-internal-test-signing.pfx
.artifacts\windows-internal-signing\junqi-internal-test-signing.cer
.artifacts\windows-internal-signing\certificate-info.txt
```

`.artifacts/` 已被 Git 忽略。仍需把 PFX 视为高敏感私钥，限制文件 ACL、禁止发送，并在不用时离线保存或销毁。

### 2. 构建并签署内部安装包

```powershell
.\scripts\windows-internal-signing\Invoke-JunQiInternalSignedBuild.ps1 `
  -PfxPath .\.artifacts\windows-internal-signing\junqi-internal-test-signing.pfx
```

脚本执行固定顺序：

1. 只编译 `junqi-desktop.exe`，暂不打包；
2. 使用 SHA-256 Authenticode 和 RFC 3161 时间戳签署主程序；
3. 使用 `signtool verify /pa /all /tw` 验证主程序；
4. 将已经签名的主程序打入 NSIS；
5. 签署最终 NSIS 安装器；
6. 验证最终安装器。

内部构建使用 `src-tauri/tauri.internal-test.conf.json` 关闭 updater artifacts，避免测试签名与 Tauri 正式 updater 签名混淆。

输出安装器位于：

```text
src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\
```

在分发前记录：

```powershell
Get-FileHash -Algorithm SHA256 .\路径\到\安装包.exe
Get-AuthenticodeSignature .\路径\到\安装包.exe | Format-List *
```

## 测试设备操作

测试人员应通过两个独立渠道取得：

- `junqi-internal-test-signing.cer`；
- `certificate-info.txt` 中的公钥证书 SHA-256 或由负责人确认的同一值。

先核对证书文件：

```powershell
Get-FileHash -Algorithm SHA256 .\junqi-internal-test-signing.cer
```

确认与负责人提供的值完全一致后，运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-internal-signing\Install-JunQiInternalTestCertificate.ps1 `
  -CertificatePath .\junqi-internal-test-signing.cer
```

脚本显示主体、thumbprint 和有效期，并要求输入：

```text
TRUST JUNQI TEST CERTIFICATE
```

证书只安装到当前用户的：

```text
Cert:\CurrentUser\Root
Cert:\CurrentUser\TrustedPublisher
```

然后验证并运行安装包：

```powershell
Get-AuthenticodeSignature .\JunQi安装包.exe | Format-List Status,StatusMessage,SignerCertificate
```

`Status` 必须是 `Valid`，签名证书 thumbprint 必须与安装步骤显示的值一致。Smart App Control 开启时仍可能按官方公共 CA 规则阻止该程序；不要尝试通过 JunQi 安装器绕过。应改用 Smart App Control 已关闭的专用测试 VM，或由管理员配置正式的组织应用控制策略。

## 删除内部信任

卸载 JunQi 不会自动删除证书，因为证书信任是用户独立批准的系统状态。测试结束后执行：

```powershell
.\scripts\windows-internal-signing\Remove-JunQiInternalTestCertificate.ps1 `
  -Thumbprint 证书的40位thumbprint
```

脚本只删除主体和 thumbprint 同时匹配的 JunQi 内部测试证书，并要求输入：

```text
REMOVE JUNQI TEST CERTIFICATE
```

## 已验证和未验证边界

脚本和仓库契约可在非 Windows 环境进行静态验证，但以下内容必须在 Windows 真机完成：

- `New-SelfSignedCertificate` 生成的证书能否被当前目标 Windows 接受；
- 主程序签名后再执行 Tauri NSIS bundle 是否保留内部签名；
- Smart App Control 已关闭或由组织策略管理时，内部 Authenticode 信任能否按预期工作；
- 安装后的主程序及卸载程序签名状态；
- 证书移除后原签名程序是否重新被阻止。

## Tag 测试发布

`tag-release.yml` 的 Windows job 在 GitHub 托管的临时 runner 中生成最长 14 天、不可导出的短期内部证书。该 job 先签署 `junqi-desktop.exe`，再构建并签署 NSIS，最后随 Release 发布：

```text
junqi-internal-test-signing.cer
junqi-internal-test-signing-info.txt
```

CI 私钥只存在于临时 runner 的当前用户证书存储，不导出、不上传。每个 tag 都生成新的证书，因此每次测试新 tag 前都必须核对并安装该 Release 对应的 CER；旧 tag 的 CER 不能用于验证新 tag。

为使 `signtool verify /pa /all /tw` 能验证自签内部证书，临时 runner 会把公开 CER 导入当前用户的 `Root` 和 `TrustedPublisher`。该信任只存在于 GitHub 托管的临时用户环境，job 结束前通过 `always()` 同时清理 `My`、`Root` 和 `TrustedPublisher` 中的对应 thumbprint；安装器不会在用户设备执行这项操作。

该 tag 路径是内部测试发布，不是公共可信正式发布。Release 说明必须保留 Smart App Control 限制，不能将 Tauri updater 的 `.sig` 描述为 Authenticode 公共信任。

在取得这些真机证据前，本流程状态为“内部 Authenticode 测试方案已实现，Windows 真机行为待验证”；不得把它描述为 Smart App Control 解决方案。

## 2026-08-05 GitHub Runner 兼容性验证

- `v2.2.3` 已在 Windows 2025 Runner 通过 678 项 Rust 测试并完成 release 模式编译。
- 该 Runner 未把 Windows SDK 的 `signtool.exe` 加入 `PATH`，旧工作流因此在应用签名步骤失败。
- 当前实现统一通过 `Resolve-JunQiSignTool.ps1` 解析工具位置，并由标签发布、正式发布与本地内部签名共同使用。
- `v2.2.4` 标签工作流用于验证 SignTool 发现与主程序签名，后续信任验证结论见下一节。

## 2026-08-05 临时证书信任验证

- `v2.2.4` 已在 Windows Runner 找到 SignTool 并成功签署 `junqi-desktop.exe`。
- 随后的 `/pa` 验证因自签根证书未受 Runner 当前用户信任而失败，公开 Release 未创建。
- `v2.2.5` 标签用于验证临时 CI 当前用户信任与无条件清理，非交互执行结论见下一节。

## 2026-08-05 非交互证书存储验证

- `v2.2.5` 的 `Import-Certificate` 在非交互 Windows Runner 写入自签根存储时持续阻塞，工作流已主动取消，未创建公开 Release。
- `v2.2.6` 改用 .NET `X509Store` 后仍在 Windows 2025 Runner 的根存储写入阶段持续阻塞，工作流已主动取消，未创建公开 Release。
- 当前实现改用 Windows 自带的 `certutil -user -f -addstore` 写入当前用户 `Root` 与 `TrustedPublisher`。每次调用都检查退出码，避免把未建立的信任误判为成功。
- thumbprint 在信任操作前写入 job output，确保后续失败时 `always()` 清理仍有精确目标；最终结果以 `v2.2.7` 标签工作流为准。

官方依据：Microsoft Learn, [certutil](https://learn.microsoft.com/windows-server/administration/windows-commands/certutil)。该契约明确列出 `-addstore`、`-user` 与 `-f` 参数。

官方依据：Microsoft Learn, [Smart App Control overview](https://learn.microsoft.com/windows/apps/develop/smart-app-control/overview)。
