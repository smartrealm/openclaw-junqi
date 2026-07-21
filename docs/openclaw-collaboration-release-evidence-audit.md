# OpenClaw Collaboration Release Evidence Audit

日期：2026-07-19

审计范围：外部 Gateway、视觉和 soak 证据从生产者 workflow 到 `release.yml` 的完整链路。

审计方法：按 `code-audit` 六阶段协议进行跨文件读取、严重度分级、规格化、修复和四层验证。本文只记录已经由源码和文件系统交叉证明的事实，不把本地局部运行结果写成外部验收。

## 1. 链路基线

发布门禁在 [`scripts/validate-external-release-evidence.mjs`](../scripts/validate-external-release-evidence.mjs) 中声明三条受信任生产者路径：

| Evidence | Trusted workflow | Artifact | Required scope |
| --- | --- | --- | --- |
| Gateway | `.github/workflows/collaboration-gateway-release-evidence.yml` | `collaboration-gateway-release-evidence/collaboration-gateway-release-evidence.json` | all P0-01..P0-14, `FULL_BEHAVIORAL` |
| Visual | `.github/workflows/collaboration-visual-release-evidence.yml` | `collaboration-visual-release-evidence/collaboration-visual-release-evidence.json` | 6 scenarios x 2 viewports, installer-bound |
| Soak | `.github/workflows/collaboration-soak-release-evidence.yml` | `collaboration-soak-release-evidence/collaboration-soak-release-evidence.json` | 24h, 6 fault classes, 10 final invariants |

[`release.yml`](../.github/workflows/release.yml) 的可信路径（仅在 `signing-enabled=true` 的受保护 promotion 上）会按这三条路径调用 `gh attestation verify --signer-workflow`，并要求三次成功、不同 run、同一 source/ref。当前候选路径不会生成一方 attestation；现有 shell 只检查 `--format json` 非空，尚未解析证明中的 run id/attempt 与所选 run 做密码学级绑定，这仍是开放 residual。

## 2. Findings（修复前快照）

本节保留审计开始时的原始 findings，用于说明缺陷来源和修复动机；其中 workflow 文件列表、发布流程和行号描述均是修复前事实，不代表当前工作树状态。当前状态以第 3 节及本文件末尾的 residual 为准。

### BUG-RE-01 · CRITICAL — 受信任证据生产 workflow 不存在

**位置**：`scripts/validate-external-release-evidence.mjs:28-31`、`.github/workflows/release.yml:601-606`；文件系统中的 `.github/workflows/` 只有 `ci.yml`、`linux-self-hosted-release.yml` 和 `release.yml`。

**问题**：发布门禁信任三个固定 signer workflow，但仓库没有任何一个对应文件，也没有历史提交提供它们。任何 tag release 都无法得到满足 `--signer-workflow` 的 attestation；即使手工生成了格式正确的 JSON，生产发布仍然无法通过。

**影响**：

- 生产发布链路必然失败，或被迫绕过 attestation 才能发布。
- 团队无法从仓库源码审查证据如何产生，release gate 的安全边界是悬空的。

**修复方向**：把三类证据生产者作为仓库源码的一部分，并让每个 producer 运行真实 harness、绑定 immutable source/ref、上传 physical artifacts、对每个 artifact 执行 attestation；缺少真实 harness 时必须 fail closed，不能生成“通过”证据。

### BUG-RE-02 · CRITICAL — 当前 Gateway harness 不能满足 external validator 的 FULL_BEHAVIORAL 契约

**位置**：`scripts/verify-collaboration-behavioral-gateway.mjs:865-877, 894-908`；`scripts/validate-external-release-evidence.mjs:496-542`。

**问题**：现有 harness 明确只验证 P0-02/03/05/06/07/08，P0-04、P0-09、P0-10、P0-11、P0-12、P0-13、P0-14 被标记为 `NOT_VERIFIED` 或 `NOT_IN_SCOPE`。external policy v7 要求恰好 14 个 case、全部 `PASS`、`scope=FULL_BEHAVIORAL`，并要求每个 case 有实际 runtime identity 和 observation artifact；P0-14 还必须证明精确 METHOD_NOT_FOUND 分类、无插件/durable ABSENT、每个 mutation/maintenance 使用点重探测与 effect 计数、五个 target 级独立 fixture 负向路径，以及物理 `P014_TRACE` artifact 的 canonical claims/workflow run/attempt/case/SHA-256 绑定并拒绝 BOM。旧的 partial 或 13-case 证据会因 policy/test-plan identity 不匹配被拒绝。

**影响**：把当前 behavioral JSON 改名或包装后提交会被正确拒绝；删除 validator 检查则会把局部测试误报为生产验收。

**修复方向**：扩展为真正覆盖剩余 P0 的 producer（包括 Desktop/runtime topology 和 reset/delete UI enforcement），或保持 release gate 阻断。不能降低 validator 的要求。

### BUG-RE-03 · HIGH — Visual/Soak 没有可执行 producer 或受控 runner 契约

**位置**：`scripts/validate-external-release-evidence.mjs:546-743`；缺少对应 workflow、harness 和 artifact contract。

**问题**：validator 要求真实安装包、两个固定 viewport 的六个场景、无浏览器错误、24 小时单调时钟、五分钟心跳、六类故障和十项最终不变量，但仓库没有生成这些 artifact 的脚本，也没有规定 runner/候选安装包如何绑定到 source SHA。

**影响**：视觉和 soak 证据无法审计来源；任何“手填证据”都可能通过格式检查却不代表真实运行。

**修复方向**：producer 必须从 immutable release candidate 下载并校验 digest，在隔离 runner 上执行真实浏览器/故障注入；所有失败、超时、artifact 缺失和 source mismatch 均退出非零，不写 `PASS` evidence。

### BUG-RE-04 · MEDIUM — 没有源码级回归测试保证 trusted topology 与 release 引用一致

**位置**：`scripts/validate-external-release-evidence.test.mjs` 当前只测试证据 payload；没有检查 trusted workflow 文件存在、为 regular file、被 `release.yml` 使用，或 artifact 名称是否一致。

**问题**：今后删除/改名 workflow 时，单元测试仍可能全部通过，直到 tag 发布才暴露。

**修复方向**：增加 source-contract test，读取 validator 导出的 topology，检查 workflow 路径、release retrieval 路径和 artifact/evidence names 的一一对应关系；对 symlink、目录和缺失文件 fail closed，并纳入 `npm test`。

### BUG-RE-05 · HIGH — Windows 多目录制品与 release asset 顶层约束冲突

**位置**：`.github/workflows/release.yml:388-401, 476-483` 与 `scripts/validate-external-release-evidence.mjs:1090-1122`。

**问题**：Windows job 同时上传 `nsis/*.exe` 和 `msi/*.msi`。下载 artifact 时会保留通配符目录层级；validator 却要求所有 release asset 是顶层普通文件，并拒绝包含 `/` 的路径。视觉 candidate 与最终 release asset 因而可能在布局阶段就无法满足同一契约。

**修复方向**：构建 job 在上传前把每个发布文件复制到唯一、可审计的顶层 staging 目录，并生成绑定 source/bundle 的 manifest；visual candidate 和发布阶段都只消费该 manifest。

### BUG-RE-06 · HIGH — 外部证据 run 没有调度和回传闭环

**位置**：`.github/workflows/release.yml:495-499, 526-542`。

**问题**：tag gate 只从 environment variables 读取三个人工填写的 run id；仓库没有触发、等待、验证或记录这些 producer run 的 orchestration。`workflow_dispatch` 甚至不进入 external gate。一个合法 tag 不能由仓库流程自身从构建推进到证据再到发布。

**修复方向**：增加 immutable-tag promotion/orchestration，显式传递 producer run id/attempt 和 candidate artifact manifest；在所有 producer 成功、attestation 和 source/ref 校验完成前不允许 publish。人工审批可以保留，但不能依赖未记录的变量注入。

### BUG-RE-07 · MEDIUM — release decision 没有持久化或签名

**位置**：`.github/workflows/release.yml:608-628`。

**问题**：`release-decision.json` 只写在 runner 工作目录并随 job 消失，最终 Release 没有可长期检索的“为什么通过/阻断”记录。

**修复方向**：上传并 attests decision artifact，绑定 source SHA、release ref、三个 producer run/attempt、bundle hash 和 physical manifest；发布摘要链接同一 artifact。

### BUG-RE-08 · MEDIUM — Release Summary 不检查 publish 结果

**位置**：`.github/workflows/release.yml:688-721`。

**问题**：Summary 的 `needs` 不包含 `publish`，也不检查其结果。平台构建和证据门禁成功时，`publish` 失败或被跳过仍可能显示“all platforms built successfully”，对运营方造成错误信号。

**修复方向**：把 `publish` 纳入 needs；tag 发布时要求 publish 成功，非 tag 构建明确报告“candidate only”，并把最终状态写入摘要和持久化 decision。

### BUG-RE-09 · CRITICAL — 特权发布没有可信 promotion 和仓库治理边界

**位置**：`.github/workflows/release.yml`、`scripts/release-source-policy.mjs`、三个 evidence producer workflow；远端仓库治理 API（2026-07-18）。

**事实**：当前分支已移除 `v*` 自动触发；来源策略对 tag 返回 `TRUSTED_PROMOTION_REQUIRED`，三个 producer 也在依赖安装前阻断。2026-07-18 最终复核的远端 `main` 为 `53959bb0e63b1a695e86e8e35c77c064c5adbc73`（版本 `1.2.23`），仓库没有 branch protection/ruleset，`production-release`、`production-release-evidence` 和 `candidate-build` environment 尚不存在；签名私钥仍存在 repository scope。引用不存在的 environment 不会自动提供审批或保护。

**影响**：不能把 tag 自带 workflow、环境变量或 ancestry 检查当作 signer 信任根。若恢复 tag 特权路径，未受保护的提交可能读取签名材料或伪造 evidence。

**修复方向**：在受保护默认分支实现 `workflow_run`/`repository_dispatch` promotion controller；固定 controller revision，解析 tag 到 source SHA，记录 producer run/attempt、attestation 和 manifest 后才允许签名/发布。同步保护 `main`、创建 required-reviewer environments、迁移所有签名 secrets 到 environment scope，并限制 `v*` tag 的创建/更新/删除主体。

### BUG-RE-10 · HIGH — Updater 资产没有进入当前发布 manifest

**位置**：当前工作树的 `src-tauri/tauri.conf.json:38,76-80`、`.github/workflows/release.yml`、`scripts/create-release-asset-manifest.mjs:12,109-110`。

**问题**：当前配置开启 `createUpdaterArtifacts` 并配置 `latest.json` endpoint，但 staging/manifest 只接受 `.dmg/.exe/.msi`，没有上传 `.app.tar.gz`、`.sig` 或 `latest.json`。即使安装包发布成功，客户端更新 endpoint 也没有完整的可验签更新集合。

**修复方向**：远端 `main` 的 `generate-updater-manifest.mjs` 已随 `1956f23` 完成三方整合；下一步让最终签名 bytes、签名文件和 `latest.json` 一起进入 source/bundle-bound manifest，并对每个公开平台做 updater 验证。该资产合同闭环前不得声称更新链路可用。

### BUG-RE-11 · HIGH — 当前功能分支不是最新主线基线（已关闭）

**事实**：2026-07-18 最终复核时，当前工作树 `5fe10ea86c797a75b703f60cf18963e0f43690d8`（版本 `0.5.4`）相对远端 `main` `53959bb0e63b1a695e86e8e35c77c064c5adbc73`（版本 `1.2.23`）为 `8` 个提交领先、`224` 个提交落后；主线已有 updater manifest 和跨平台安装变更。

**影响**：直接合并当前发布 workflow 会回退版本和主线发布能力，不能作为生产候选。

**修复方向**：先以远端 `main` 为新基线，三方移植 collaboration changes，再重新运行本审计的全部契约和真实 Gateway 门禁；禁止用本地旧 `main` 或直接覆盖主线文件代替整合。

**关闭证据（2026-07-20）**：已获取并三方合入 `origin/main@1956f23`（`1.2.27`），生成合并提交 `5aa8901`；冲突按当前主线运行时接口逐项解决，依赖锁定恢复到 OpenClaw `2026.7.1`。合并后 Plugin 364/364、Desktop 1157/1157、辅助脚本 207/207、Rust 534/534、lint、YAML 解析和 production build 均通过。BUG-RE-11 关闭，但 BUG-RE-09、BUG-RE-10 和真实 Gateway/视觉/soak 门禁不因此关闭。

## 3. 修复后状态（更新至 2026-07-20）

本审计的前两节保留了修复前的事实和风险记录。随后已完成一次最小、可审计的发布链修复；下表区分“结构性缺陷已修复”和“真实证据能力仍未具备”，不把占位 producer 当成生产验收：

| Finding | 当前状态 | 证据 |
| --- | --- | --- |
| BUG-RE-01 | 结构已补齐；能力仍 fail-closed | 三个受信任 workflow 已作为 regular repository files 提交；`run-collaboration-release-evidence.mjs` 在缺少真实 harness 时只写 `blocker.json` 并退出非零 |
| BUG-RE-02 | 开放 | 当前隔离 Gateway harness 仍只覆盖 P0-02/03/05/06/07/08；producer 拒绝把 partial JSON 提升为 `FULL_BEHAVIORAL` |
| BUG-RE-03 | 开放 | visual/soak workflow 已存在，但真实 installer-bound browser 与 24 小时 fault-injection harness 缺失，producer 明确返回 `VISUAL_HARNESS_REQUIRED` / `SOAK_HARNESS_REQUIRED`；validator 还会拒绝单候选证据覆盖多平台发布资产 |
| BUG-RE-04 | 已修复 | `scripts/collaboration-release-evidence-contract.test.mjs` 检查 regular file、workflow_dispatch、artifact/evidence 名称、release retrieval 和发布 DAG |
| BUG-RE-05 | 已修复 | `scripts/stage-release-assets.mjs` 将每个平台制品扁平化为唯一 ASCII 名称；`create-release-asset-manifest.mjs` 绑定 source SHA、bundle digest 和每个安装包 digest |
| BUG-RE-06 | 开放 | tag gate 仍要求三个独立 producer run；当前 run id 由受保护 environment variables 注入，尚未实现自动 dispatch/wait/promotion handoff |
| BUG-RE-07 | 结构已修复；受 gate 到达范围约束 | `release-decision.json` 先初始化为 source/ref-bound BLOCKED；validator 成功或失败后保留一个有界、扫描过的 durable snapshot，随后上传/attest。SATISFIED 时，经过同一 source/ref、manifest、decision 和物理资产校验的 publication snapshot 会随 release assets 一起公开留痕，供长期审计；BLOCKED 仍只保留为 workflow artifact。若 job 在初始化前被取消或 skipped，不声称存在 decision artifact |
| BUG-RE-08 | 已修复 | Release Summary 显式依赖 `publish`；tag 必须 publish 成功，非 tag 明确标记 candidate-only |
| BUG-RE-09 | 开放且当前 fail-closed | tag trigger 已移除；来源策略和三个 producer 明确返回 `TRUSTED_PROMOTION_REQUIRED`。远端 branch protection、ruleset、required-reviewer environments 尚未配置，repository scope signing secrets 仍需迁移 |
| BUG-RE-10 | 开放 | 主线 updater manifest 生成器已合入，但 updater endpoint 与 release asset contract 仍不一致；必须把最终签名资产和 `latest.json` 接入同一 manifest 与验证链 |
| BUG-RE-11 | 已关闭 | 已三方合入 `origin/main@1956f23` / `1.2.27`，合并提交 `5aa8901`；合并后全量自动化、静态检查和 production build 通过 |

当前源码快照的隔离 Gateway 记录已补齐，但仍是 partial scope：structural evidence 为 [`evidence.json`](../.artifacts/collaboration-real-gateway-owner-ttl-20260719/20260718213349-264598dc20/evidence.json)，payload-free behavioral evidence 为 [`evidence.json`](../.artifacts/collaboration-behavioral-gateway-owner-ttl-20260719/20260718213129-521c5279a4/evidence.json)。两者均绑定 bundle `bea9b0ac...`、固定 OpenClaw `2026.7.1` image digest，cleanup errors 为空；behavioral 只验证 P0-02/03/05/06/07/08，且 Gateway/provider/failure/evidence artifact 不保留 prompt/plan 原文，不能升级为 `FULL_BEHAVIORAL`。

供应链边界（同日追加）：所有 GitHub Actions 已固定到完整 commit SHA，并由 `scripts/workflow-action-pins.mjs` 集中 allowlist；pnpm 固定为 `9.15.9`，Rust 固定为 `1.96.0`。producer 执行 job 不再持有 OIDC/attestation 权限，且在 promotion controller 缺失时于依赖安装前返回 `TRUSTED_PROMOTION_REQUIRED`；当前 Desktop candidate 的一方 attestation jobs 也全部 skipped。Gateway/visual/soak 的正式 publish 根在 producer 上传前、release validator 下载后执行共享 secret scanner；quality JSON、structural smoke 和二进制截图/安装包不经过同一文本扫描，仍只受 schema、路径、大小、digest 和 attestation 约束。release candidate 的来源 workflow 固定到事件 SHA，不读取发布签名密钥，候选构建显式关闭 Tauri updater artifacts。`release.yml` 不监听 tag push；所有手动 tag producer 路径仍需 promotion/runner gate。soak/Linux runner preflight 仅由受保护 repo boolean 声明外部 controller 已 provision runner，workflow 不证明实际 online、JIT 或一次性属性。Windows/macOS 签名、notarization 和 updater 资产整合均保持 fail closed；publish 采用空 draft -> 远端资产 reconciler -> digest 校验 -> publish，拒绝 `--clobber`。

发布事务硬化（同日追加）：draft lookup 使用受认证 release list，因为 GitHub 按 tag endpoint 不返回 draft；重跑只恢复带精确 source marker 的 draft。远端已有资产必须先通过 name/size/SHA-256 校验；额外资产或同名冲突立即阻断。GitHub 上传 502 遗留的资产只在同一 owned draft、精确 id/name、`state=starter` 且 size=0 时有界删除，其他状态一律 fail closed。实际上传不再调用按 tag 重新解析 release 的 CLI 路径，而由 release-id-bound uploader 从 `O_NOFOLLOW` 稳定文件描述符流式发送，边发送边验证 size/SHA-256；模糊 POST 结果必须先对账同一 release id，确认缺失后才重试。publication manifest 还会再次绑定当前 installer bytes，避免 snapshot 后的本地替换被“当前目录重新 hash”掩盖。若 publish 已提交但响应丢失，重跑只读验证同一 marker/release id/完整资产/tag 后收敛，不重复 mutation。内部 artifact 名绑定稳定 `run_id`，同一 run 重试显式 overwrite，未重跑的成功上游仍可被下游解析；Node release transaction adapters 在发送 token 前验证无凭据 HTTPS，error body、request deadline 和共享 RetryBudget 有界，普通瞬态错误使用短指数退避，明确的 GitHub 403/429 限流优先遵循 `Retry-After` 或 `x-ratelimit-reset`，无提示时至少等待一分钟；provider wait 超过 60 秒 cap 或 transaction budget 时直接 fail closed，不提前重试。当前 workflow 已将创建/恢复 draft 与 release-id `PATCH` 发布统一接入 `scripts/mutate-github-release.mjs`；该 adapter 对 POST/PATCH 的不确定结果先按 release-id、再按 tag+marker 做有界对账，不能确认时 fail closed。workflow 中剩余的 `gh` 调用仅用于 attestation 或只读 tag/ref 检查，不再承担 release mutation；受保护 promotion writer、job timeout、immutable tag ruleset 与 protected environment 仍是并发治理边界。最终发布按同一 release id 做 draft/published 两次集合校验，并在发布后再次验证 tag target。并发主体仍可能在最后一次检查后修改 tag/release，所以 immutable tag ruleset、唯一 promotion writer 与 protected environment 仍是不可替代的外部边界。

Publication snapshot hardening（同日追加）：`scripts/stage-release-publication.mjs` 在复制并校验 installer、manifest、decision 的稳定字节后生成 `JUNQI_RELEASE_PUBLICATION_SEAL`，绑定 source SHA、release ref、精确顶层文件集合、大小和 SHA-256。seal 使用独占 `O_NOFOLLOW` 文件写入；publish job 在 provenance attestation 前把 publication 目录锁为只读，并把 seal 字节 digest 固定到跨 step output；随后 reconcile、upload、draft/published verify 的 CLI 都必须同时匹配同一 seal 与该可信 digest，并重新核对当前文件集合；三个适配器函数在复核时也再次绑定 `sourceSha` 与 `refs/tags/<tag>`，避免未来内部调用者只传文件摘要而串用另一事务。已知 create candidate release id 只允许按该 id 有界收敛，不能回退到同 tag 的另一个 release；PATCH 歧义若无法按该 id 确认则立即 fail closed，禁止下一次 PATCH。单 installer 2 GiB 上限另预留 2 MiB provenance allowance；1 MiB/s 最低速率、45 分钟请求上限、120 分钟共享预算与 150 分钟 job timeout 现在一致。跨 run 的 deletion/export receipt、completed job digest 和实际 artifact 内容也在 Desktop typed facade 中做绑定与常量时间校验。

低层 Node 适配器的 `publicationSeal` 参数暂仍允许缺省，供已有纯单元测试和非发布资产扫描复用；它们不是当前 workflow 的生产入口，CLI 解析层已强制 `--seal`、`--seal-sha`，且适配器收到 seal 时会复核 source/ref。若未来把这些函数升级为正式公共发布 API，应移除该兼容旁路，改为必填的 `PublicationSealContext`，并拒绝未经过 manifest/decision/byte-budget 扫描的 synthetic `localAssets`。

Attestation identity residual（同日追加）：当前 CLI 调用能验证 signer workflow、source digest/ref 和签名有效性，但 `--format json` 结果尚未解析出并绑定所选 producer 的 run id/attempt。更关键的是，未来若由受保护 default-branch controller dispatch producer，attestation 证书的 controller ref/SHA 与目标 release tag/source SHA 是两套 identity；在没有明确的双 identity predicate/验证器之前，不能启用 signing 或把 candidate evidence 当 release evidence。

## 4. 结论

当前代码层领域状态、自动化回归、当前 bundle parity 和适用范围内的隔离真实 Gateway 证据已经完成，但 release workflow 仍不能被标记为生产发布通过。当前 bundle 为 `bea9b0ac...`；structural P0-01 与 behavioral P0-02/03/05/06/07/08 已通过，但 validator 仍要求包含 P0-01..P0-14 的 `FULL_BEHAVIORAL`。还必须完成 BUG-RE-02/03 的真实 harness，建立 BUG-RE-06/09 的默认分支 promotion 和仓库治理，完成 BUG-RE-10/11 的主线整合；随后以同一受信 source identity 运行三类 producer、覆盖所有公开平台的 installer-bound 视觉证据、验证 attestation 并重新执行外部 validator。任何 partial、mock、capability-only 或 blocker JSON 都不能满足发布门禁。

签名环境的必要配置也属于发布前置条件：`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；macOS 还需要 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`；Windows 需要 `WINDOWS_PFX_BASE64`、`WINDOWS_PFX_PASSWORD`、`WINDOWS_TIMESTAMP_URL`。当前远端检查显示签名私钥仍在 repository scope，且 `production-release` environment 不存在；必须先迁移并配置 required reviewers/部署来源，再恢复任何特权 promotion。任一缺失，发布必须失败。
