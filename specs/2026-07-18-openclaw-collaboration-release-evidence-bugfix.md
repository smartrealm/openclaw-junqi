# OpenClaw Collaboration Release Evidence Bugfix Specification

日期：2026-07-18

## BUG-RE-01 — Trusted evidence producer topology

**Status**：结构性拓扑已完成；真实 producer harness 仍开放，故不能视为发布验收完成。

**Current**：`validate-external-release-evidence.mjs` and `release.yml` name three trusted workflow paths, but none exists in `.github/workflows/`. A tag release cannot obtain a valid signer workflow attestation.

**Target**：Trusted workflow paths are represented by regular repository files and each has a documented, executable producer contract. The release gate verifies exact workflow path, immutable source commit/ref, run id/attempt, artifact name, and attestation. A producer that lacks its real harness fails non-zero and cannot emit PASS evidence.

**Acceptance**:

- [x] Every `TRUSTED_EVIDENCE_WORKFLOWS` path exists as a non-symlink regular file.
- [x] Each producer uses an immutable checkout/ref and writes only its declared evidence/artifact names.
- [x] `release.yml` retrieves exactly the producer artifact and verifies its signer workflow.
- [x] Missing runtime prerequisites fail the producer before any PASS evidence is written.

## BUG-RE-02 — Full Gateway behavior scope

**Status**：开放；当前 producer 会拒绝 partial harness，尚未具备全 P0 真实适配器。

**Current**：The local behavioral harness verifies only P0-02/03/05/06/07/08 and explicitly leaves P0-04/09/10/11/12/13/14 outside its scope. External policy v7 requires all P0-01..P0-14 and `FULL_BEHAVIORAL`; its P0-14 contract additionally requires exact METHOD_NOT_FOUND classification, use-point absence re-probes, bounded core-effect counts, five target-distinct negative fixtures, and a physical `P014_TRACE` artifact whose canonical claims, workflow run/attempt/case identity, bytes, and SHA-256 are verified without accepting BOM-prefixed alternatives.

**Target**：A separate full producer combines structural and behavioral real-runtime scenarios, including Desktop/runtime topology and session mutation enforcement, and emits exactly one PASS case per required P0 with observed identities and physical artifacts. Partial harness output remains in a distinct non-release evidence format.

**Acceptance**:

- [ ] Full producer rejects any missing or non-PASS P0 case.
- [ ] Every case records runtime identity and an observation artifact.
- [ ] No case is marked verified by a mock, unit test, or capabilities-only response.
- [ ] Existing partial harness continues to fail closed when full scope is requested.

## BUG-RE-03 — Visual and soak producers

**Status**：开放；workflow 和 fail-closed 边界已存在，真实 browser/soak harness 尚未实现。

**Current**：No executable producer exists for the validator's six visual scenarios/two viewports or 24-hour fault/soak contract.

**Target**：Visual producer installs and launches the exact candidate artifact, drives both policy viewports with a real browser, records screenshots/traces and zero browser errors. Soak producer runs the real durable runtime for at least 24 hours with five-minute monotonic heartbeats, all required faults, bounded resource metrics, and final invariant checks. Both bind output to source/ref/bundle and attest every physical artifact.

**Acceptance**:

- [ ] Visual output contains all 12 scenario/viewport pairs and exactly one digest-matching installer.
- [ ] Soak output contains duration, heartbeats, all six faults, all ten invariants, LOG and METRICS artifacts.
- [ ] Any timeout, missing artifact, source mismatch, or invariant failure exits non-zero and emits no PASS evidence.
- [ ] Producer runner prerequisites are explicit and checked before execution.

## BUG-RE-04 — Trusted topology regression

**Status**：结构性完成；仅当 trusted gate job 实际启动并到达初始化步骤时适用，取消或 skipped 的 job 不声称产生 artifact。

**Current**：Payload tests do not inspect repository workflow topology; deleting a trusted producer would pass local tests.

**Target**：A source-contract test imports the canonical topology, lstat-checks every workflow, and verifies release retrieval references and artifact/evidence names match the same contract.

**Acceptance**:

- [x] Missing, symlinked, directory, or duplicate producer workflow fails the test.
- [x] Release workflow references every trusted producer exactly once for retrieval and signer verification.
- [x] Artifact/evidence naming drift fails before release.
- [x] Test is included in `npm test` and runs without network access.

## BUG-RE-05 — Release asset layout

**Status**：已完成。

**Current**：Windows uploads preserve `nsis/` and `msi/` directories, while external evidence validation accepts only top-level release asset files.

**Target**：Every build matrix job stages uniquely named installer files in one flat, regular-file directory and uploads a source/bundle-bound manifest. Visual and publish jobs consume the same bytes.

**Acceptance**:

- [x] Downloaded release assets contain no nested paths or symlinks.
- [x] Each staged name is unique across all platforms and its digest is recorded.
- [x] Visual candidate digest matches the exact staged release file.

## BUG-RE-06 — Producer orchestration

**Status**：开放；当前仍使用受保护 environment variables 传递三个已成功 producer run id，自动 dispatch/wait handoff 尚未实现。

**Current**：The tag gate depends on three manually configured environment variables and does not dispatch or wait for evidence producers.

**Target**：An immutable-tag promotion flow records producer run ids/attempts, source SHA/ref, candidate artifact manifest, and attestation results before invoking the release gate.

**Acceptance**:

- [ ] A producer run cannot be accepted if its ref, source SHA, attempt, or workflow path differs.
- [ ] Missing producer runs and stale attempts block publish with a structured reason.
- [ ] The handoff is persisted as a retrievable artifact.

## BUG-RE-07 — Durable release decision

**Status**：结构性完成；仅当 trusted gate job 实际启动并到达初始化步骤时适用，取消或 skipped 的 job 不声称产生 artifact。

**Current**：The validator output used to be left in a transient runner directory; the workflow now initializes a source/ref-bound BLOCKED fallback, atomically replaces it only with a schema-valid result, copies a bounded snapshot, scans that snapshot, and uploads/attests it. When the decision is `SATISFIED`, the same source/ref-bound decision and release manifest are also staged with the verified installer set as public release assets, creating a long-lived audit record; a `BLOCKED` decision remains a durable workflow artifact and is never published as a release.

**Target**：The final decision is uploaded and attested as a bounded artifact, including all source, bundle, producer, and physical-artifact identities.

**Acceptance**:

- [x] A gate that reaches initialization uploads a decision artifact even when prerequisites or validation are blocked; unexpected validator output cannot delete the fallback.
- [x] Decision artifact is bound to the exact source/ref and the uploaded snapshot passes the shared text scanner; binary artifact content remains outside text scanning.
- [x] When a trusted publish reaches `SATISFIED`, the exact decision and release manifest are included in the staged publication snapshot and public release asset set; `BLOCKED` decisions are retained as workflow evidence only. This structural capability does not claim that the currently blocked production path has published an asset.
- [x] Release summary points to the artifact/run.

## BUG-RE-08 — Summary publication status

**Status**：已完成。

**Current**：Release Summary does not depend on or evaluate `publish`.

**Target**：Summary has an explicit candidate path for non-tags and requires successful `publish` for tags; its status is consistent with the actual GitHub Release mutation.

**Acceptance**:

- [x] A failed/skipped tag publish makes the summary fail.
- [x] Non-tag builds report candidate-only status without claiming publication.
- [x] The summary records external gate and publish results.

## BUG-RE-09 — Trusted promotion and repository governance

**Status**：开放且 fail-closed。当前 `release.yml` 不再监听 `v*`，`release-source-policy.mjs` 和三个 evidence producer 对 tag/未授权 handoff 返回 `TRUSTED_PROMOTION_REQUIRED`。

**未完成项**：远端 `main` protection、tag ruleset、`production-release`/`production-release-evidence` required-reviewer environments 尚未配置；签名 secrets 仍在 repository scope。必须建立默认分支 `workflow_run`/`repository_dispatch` promotion controller，并在外部仓库设置完成后再启用签名和 publish。

## BUG-RE-10 — Updater artifact closure

**Status**：开放。当前工作树开启了 Tauri updater artifacts/endpoint，但 release asset contract 只接收安装包扩展名，尚未纳入 `.app.tar.gz`、`.sig` 和 `latest.json`。远端主线已有 `generate-updater-manifest.mjs`，必须在主线整合后绑定最终签名 bytes 并验证每个平台。

## BUG-RE-11 — Mainline baseline integration

**Status**：开放。2026-07-18 最终复核时，当前分支落后远端 `main`（`53959bb...`, `1.2.23`）224 commits，工作树版本为 `0.5.4`。必须以远端主线为基线三方移植 collaboration changes，不能直接合并当前旧 release workflow。

## BUG-RE-12 — Evidence content confidentiality

**Status**：结构性防护已完成，真实 producer 仍被 promotion gate 阻断。对正式 publish evidence 的文本部分，`evidence-content-policy.mjs` 使用有界流式扫描；producer 上传前和 release validator 下载后都拒绝高置信 credential patterns，错误信息不包含匹配字节。quality JSON、structural smoke 与二进制截图/安装包不经过同一文本扫描，仍受各自 schema、路径、大小、digest 和 attestation 约束，并保留 scanner/OCR residual。

## BUG-RE-13 — Immutable publication asset set

**Status**：结构性防护已完成，publish 当前不可达。draft lookup 使用 authenticated release list；`scripts/mutate-github-release.mjs` 负责创建/恢复 owned draft 与 release-id 发布，POST/PATCH 响应丢失、格式异常或瞬态失败时先按 release-id、再按 tag+marker 做有界对账，无法确认则 fail closed。发布先创建空 draft，`reconcile-github-release-assets.mjs` 按 immutable release id 校验远端集合，只对同一 owned draft 中精确 name/id、`state=starter`、size=0 的残留执行有界 DELETE。`upload-github-release-assets.mjs` 不再按 tag 二次解析 release，而是使用 release-id-bound upload URL，从 `O_NOFOLLOW` 稳定文件描述符流式发送并同步核对 size/SHA-256；POST 响应丢失或 502 时先对账同一 release id，再决定是否重试。Node 读、删、上传和 release mutation adapters 共享 Retry Policy 与 transaction budget：普通瞬态状态采用短指数退避，GitHub 403/429 限流遵循 `Retry-After` 或 `x-ratelimit-reset`，无提示时至少等待一分钟；provider wait 超过 60 秒 cap 或共享 budget 时直接 fail closed，不提前重试。额外/冲突资产、非空 starter、文件身份漂移和 manifest 不一致均 fail closed；`verify-github-release-assets.mjs` 再按 name/size/SHA-256 验证完整本地/远端集合。artifact 绑定稳定 `run_id` 并在同一 run 重试时显式 overwrite；publish 响应丢失时可只读验证已提交 release 后收敛；发布前后复核 tag target，代码不使用 `--clobber`。workflow 中剩余 `gh` 调用仅用于 attestation 或只读 tag/ref 检查，不再直接执行 release mutation。SATISFIED 决策、release manifest 与已验证 installer 只从同一 publication snapshot 公开发布，确保决策和资产长期留痕；BLOCKED 决策不会被当作公开 release 资产。

## 供应链与签名边界（追加）

**Status**：结构性防护已完成；可信 promotion、仓库保护和真实 notarization/证书仍是开放门禁，保持 fail closed。

- [x] 所有仓库 workflow action 固定到完整 commit SHA。
- [x] Gateway/visual/soak producer 的执行 job 不持有 `id-token` 或 `attestations` 权限；trusted attestation job 仅在 `signing-enabled=true` 受保护 promotion 上运行，candidate attestations skipped。
- [x] Producer checkout 使用输入 `source_sha`，并校验事件 SHA 与实际 `HEAD` 一致；未有可信 promotion 时在依赖安装前阻断。
- [x] 手动 candidate 的代码级输入只允许 `main`，build action 不接收发布签名密钥；远端 `main` protection 仍待配置。
- [x] Windows tag 构建的 Authenticode/signing 代码在特权路径中缺少证书或时间戳即失败；特权路径当前不可达。
- [x] macOS tag 构建的 Developer ID/notary/staple 检查在特权路径中缺少凭据即失败；特权路径当前不可达。
- [x] 单候选 visual evidence 遇到多平台 release asset 时拒绝通过，直到 per-platform installer-bound harness 完成。
- [x] unsigned candidate 显式关闭 `createUpdaterArtifacts`，不会以假 key 生成不可验证更新包。
- [x] pnpm `9.15.9`、Rust `1.96.0` 和 workflow action identity 均固定；正式 publish producer/validator 对文本 evidence 执行共享 secret scanner，quality/structural/binary 内容仍是开放扫描 residual。
- [x] Publish 代码采用空 draft -> release asset reconciler -> 远端 asset SHA-256 校验 -> publish 两阶段流程，拒绝既有 release、冲突资产和 `--clobber` 覆盖。

## 供应链 residual（未关闭）

- GitHub attestation JSON 当前只做非空检查，尚未从证明中解析并绑定选定 producer 的 run id/attempt；可信 promotion controller 必须补上这层 identity 校验。
- soak/Linux runner preflight 只读取受保护 repo variable；它不能证明实际 job 使用 JIT、online 或一次性 runner。
- release 最后一次 tag/release 检查之后仍存在远端并发写窗口；必须配置 immutable tag ruleset、唯一发布 writer 和 required-reviewer environment。
- 当前 bundle `bea9b0ac...` 已重新运行隔离真实 Gateway：structural P0-01 与 payload-free behavioral P0-02/03/05/06/07/08 evidence 均 `PASSED`；P0-04/09/10/11/12/13/14、视觉、soak 和 FULL_BEHAVIORAL producer 仍未完成。behavioral Gateway/provider/failure/evidence artifact 经过固定事件码投影和动态 sentinel 门禁，不持久化 prompt/plan 原文；`promptContentPersisted=false` 仍只描述 provider audit，不扩大为运行时日志保证。
- 可信 promotion 还需定义 controller identity 与目标 release source/tag identity 的双绑定；在 producer 由受保护 default branch dispatch 时，不能直接把 controller 的 attestation ref/SHA 当成目标 tag 的 ref/SHA。
