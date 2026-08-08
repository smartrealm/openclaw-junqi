# Gateway 设备身份钥匙串提示去重计划

## 步骤

1. [x] 核对迁移、凭据读取、身份引用和 challenge 签名调用图。
2. [x] 在设备身份服务边界增加单飞查询，并在失败时释放状态。
3. [x] 更新质量记录与规格，明确 OpenClaw 协议边界和未验证的系统授权行为。
4. [ ] 在 macOS 正式签名包中验证首次授权只显示一次。

## 文件范围

- `src/services/gateway/deviceAuthentication.ts`
- `src/services/gateway/credentialProvider.ts`
- 对应 docs、specs、plans 记录
