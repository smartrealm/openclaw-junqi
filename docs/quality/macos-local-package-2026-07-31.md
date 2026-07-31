# macOS Apple Silicon 本地测试包验证

日期：2026-07-31

状态：本机 ad-hoc 签名测试包已按合并后的当前工作树重建，未完成 Developer ID 签名或公证。

## 依据

- 当前实际版本为 `1.5.0`：`package.json`、`src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json` 一致。
- 打包时目标工作分支的 `HEAD` 为 `8e8734ce2c38181aa4b08b45cbf6bf1164860d99`，本地 `main` 为 `d6cce66122c0153aec792829ac6fdb0f127ee110`。本次重建纳入 `main` 的代码和 1.5.0 发布元数据；未创建新的 Git 提交，制品对应当前 dirty 工作树，而非单独的 `HEAD` 提交。
- 本机构架为 Apple Silicon（`arm64`）。
- `security find-identity -v -p codesigning` 未找到 Developer ID identity，且没有 updater 私钥；因此不能生成或声称拥有正式发布签名。
- `src-tauri/tauri.no-updater-artifacts.conf.json` 只在本次命令中合并，将 `bundle.createUpdaterArtifacts` 设为 `false`，不修改正式发布配置。

README 版本显示已同步为 `1.5.0`。

## 打包命令

```bash
APPLE_SIGNING_IDENTITY=- pnpm tauri build \
  --target aarch64-apple-darwin \
  --bundles app,dmg \
  --config src-tauri/tauri.no-updater-artifacts.conf.json \
  --ci
```

命令成功。Tauri 在打包时执行了前端 production build、collaboration bundle 校验、Rust release build、app bundle 和 DMG bundle。由于不存在 Apple notarization 凭据，Tauri 明确跳过 notarization。

## 制品与验证

- DMG：`src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/JunQi Desktop_1.5.0_aarch64.dmg`
- 应用：`src-tauri/target/aarch64-apple-darwin/release/bundle/macos/JunQi Desktop.app`
- DMG 大小：`8,435,191` bytes。
- SHA-256：`5ac4928735ec34778d411b8ac7614c2d7663c9756d72976b9de144fff4364edd`
- `hdiutil verify` 通过。
- 源 app 与 DMG 挂载后的 app 均通过 `codesign --verify --deep --strict`。
- 挂载后的 `Info.plist` 为版本 `1.5.0`、bundle identifier `com.junqi.junqidesktop`。
- 可执行文件为 Mach-O `arm64`。
- 签名为 `adhoc,runtime`，没有 Team Identifier；`spctl --assess` 以退出码 `3` 拒绝该 app，符合未公证本地测试包的预期。

## 未验证边界

- 未完成 Developer ID 签名、Apple notarization、stapling、updater signature 或发布资产校验。
- 未从 DMG 完成实际安装并启动 Tauri 应用；首次启动、权限、Gateway、Keychain、Dynamic Island、宠物窗口和 macOS 版本兼容性仍需真机验收。
