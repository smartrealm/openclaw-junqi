# Windows 内部测试签名实施计划

## 阶段 1：证书生命周期

- 新增 PowerShell 证书生成脚本，默认输出到被忽略的 `.artifacts/`。
- 分离 PFX 和 CER，仅向测试人员分发 CER。
- 新增当前用户信任安装脚本和按 subject/thumbprint 删除脚本。

## 阶段 2：签名构建

- 使用 Tauri `--no-bundle` 先生成主程序。
- 使用 SignTool 对主程序执行 SHA-256 Authenticode 和 RFC 3161 时间戳签名。
- 验证主程序后执行 Tauri NSIS bundle。
- 签署并验证最终 NSIS 安装器。
- 内部测试配置关闭 updater artifacts。
- Tag 测试发布在 Windows 临时 runner 生成不可导出的短期证书，并只上传 CER 和证书信息。

## 阶段 3：文档和守护

- 记录测试人员先安装 CER、后运行安装包的明确流程。
- 新增源码契约测试，防止安装器静默安装根证书或签名顺序回退。
- 更新文档索引。

## 验证

```text
pnpm lint
node --test scripts/windows-internal-signing.test.mjs
git diff --check
```

Windows 真机补充验证：证书导入、主程序和安装器签名、Smart App Control、安装后文件、卸载程序及证书撤销。
