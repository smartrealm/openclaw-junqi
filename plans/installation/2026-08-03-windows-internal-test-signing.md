# Windows 内部测试签名实施计划

## 阶段 1：证书生命周期

- 新增 PowerShell 证书生成脚本，默认输出到被忽略的 `.artifacts/`。
- 分离 PFX 和 CER，仅向测试人员分发 CER。
- 新增当前用户信任安装脚本和按 subject/thumbprint 删除脚本。

## 阶段 2：签名构建

- 使用 Tauri `--no-bundle` 先生成主程序。
- 使用 SignTool 对主程序执行 SHA-256 Authenticode 和 RFC 3161 时间戳签名。
- 通过共享解析器从 `PATH`、Windows Kits 注册表和标准 SDK 目录定位 SignTool，避免依赖 Runner 的临时 `PATH` 布局。
- 验证主程序后执行 Tauri NSIS bundle。
- 签署并验证最终 NSIS 安装器。
- 内部测试配置关闭 updater artifacts。
- Tag 测试发布在 Windows 临时 runner 生成不可导出的短期证书，并只上传 CER 和证书信息。
- 临时 runner 通过 Windows `certutil -user -f -addstore` 在当前用户证书存储中信任公开 CER，以执行 Authenticode 验证，并在 `always()` 清理私钥与信任项。

## 阶段 3：文档和守护

- 记录测试人员先安装 CER、后运行安装包的明确流程。
- 新增源码契约测试，防止安装器静默安装根证书或签名顺序回退。
- 标签发布、正式发布和本地内部签名必须复用同一 SignTool 解析器。
- 更新文档索引。

## 验证

```text
pnpm lint
node --test scripts/windows-internal-signing.test.mjs
git diff --check
```

Windows 真机补充验证：证书导入、主程序和安装器签名、Smart App Control、安装后文件、卸载程序及证书撤销。
