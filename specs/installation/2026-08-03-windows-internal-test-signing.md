# Windows 内部测试签名规格

## 问题

JunQi 的未签名 Windows 内部构建缺少可验证发布者身份。团队暂不采用公共 CA 代码签名，但需要在 Smart App Control 已关闭或由组织策略管理的受控测试设备上继续真机验证。Microsoft 要求 Smart App Control 认可的签名来自 Windows Trusted Root Program 中的 CA，自签证书不是该拦截的通用解决方案。

## 目标行为

1. 签名机可生成用途和有效期受限的内部代码签名证书。
2. 私钥 PFX 与公钥 CER 分离，PFX 不进入安装包、仓库或测试设备。
3. `junqi-desktop.exe` 必须在 NSIS 打包前签名并验证。
4. 最终 NSIS 安装器必须在打包后签名并验证。
5. updater artifacts 在内部测试构建中关闭，不能与正式发布签名混淆。
6. 测试人员在运行安装包前，独立核对并明确安装 CER。
7. 信任只写入当前用户的 Root 和 TrustedPublisher，不静默修改 LocalMachine。
8. 安装脚本必须显示 subject、thumbprint、有效期并要求固定确认语句。
9. 删除脚本必须同时校验 subject 和 thumbprint，避免删除无关证书。
10. JunQi 安装器和卸载器不得自动安装或删除根证书。
11. Tag 测试发布使用临时 runner 内不可导出的短期证书，先签主程序再签 NSIS。
12. Release 只发布 CER 和证书信息，不发布 PFX；每个 tag 的证书身份相互独立。

## 非目标

- 不建立面向普通用户的公共信任。
- 不承诺绕过 Smart App Control、SmartScreen 或企业策略，并明确 Smart App Control 的公共 CA 要求。
- 不把测试证书称为正式签名证书。
- 不关闭 Windows 安全功能。
- 不把 PFX 或密码放进 GitHub Repository Secret。

## 验收

- 源码契约测试覆盖证书主体、当前用户证书存储、显式确认、PFX 隔离和先签主程序再打包的顺序。
- `pnpm lint`、相关脚本测试和 `git diff --check` 通过。
- Windows 真机验证前，文档明确标记 Smart App Control 放行效果待验证。
