# OpenClaw Collaboration Release Evidence Plan

## Execution order

安全前置：所有未来 producer promotion 必须同时传递版本 tag 和完整 `source_sha`；producer 在依赖安装前校验 `GITHUB_SHA == git rev-parse HEAD`，并且在没有默认分支 promotion handoff 时返回 `TRUSTED_PROMOTION_REQUIRED`。当前仓库尚未配置 `main` protection、ruleset 或 `production-release-evidence` environment；这些外部治理完成前不得读取签名材料。执行 job 不持有 OIDC/attestation 权限；candidate 的一方 attestation jobs 直接 skipped，trusted attestation 只在受保护 promotion 上运行。手动 candidate 的代码级输入只能选择 `main`，不会读取发布签名密钥。soak/Linux runner 的 preflight 只接受受保护 repo boolean 声明，不能证明实际 JIT、online 或一次性 runner；attestation JSON 还必须解析并绑定 producer run id/attempt，并完成 controller 身份与目标 release tag/source 身份的双绑定。

### Phase A — Release-chain correctness

| Bug | File | Fix |
| --- | --- | --- |
| BUG-RE-01 | `.github/workflows/collaboration-*.yml`, `.github/workflows/release.yml` | Add real, source-bound evidence producer contracts; keep tag gate fail-closed until each producer is complete. |
| BUG-RE-04 | `scripts/validate-external-release-evidence*.mjs`, `package.json` | Add executable source-topology regression checks for trusted workflow files and release retrieval names. |
| BUG-RE-05 | `.github/workflows/release.yml`, release asset staging | Flatten installer assets into a manifest-bound top-level directory before upload and visual verification. |
| BUG-RE-07 | `.github/workflows/release.yml` | Persist and attest the final external release decision; for `SATISFIED`, publish the exact decision/manifest with the verified installer snapshot for long-term audit. |
| BUG-RE-08 | `.github/workflows/release.yml` | Make the summary depend on and report the publish result. |

### Phase B — Evidence scope

| Bug | File | Fix |
| --- | --- | --- |
| BUG-RE-02 | `scripts/verify-collaboration-behavioral-gateway.mjs` and new P0 harness modules | Implement remaining P0 scenarios against isolated real runtime; never downgrade validator requirements. |
| BUG-RE-03 | new visual/soak harnesses and producer workflows | Implement installer-bound browser and 24-hour fault-injection evidence with explicit runner and artifact contracts. |
| BUG-RE-06 | promotion/orchestration workflow | Replace untracked environment-only producer run ids with an immutable-tag promotion handoff. |
| BUG-RE-09 | `.github/workflows/release.yml`, `scripts/release-source-policy.mjs`, repository settings | Keep tag-owned workflows fail-closed; add protected default-branch promotion and move signing secrets to protected environments before enabling publish. |
| BUG-RE-10 | `src-tauri/tauri.conf.json`, updater manifest/staging | Reconcile mainline updater manifest generation with the source/bundle-bound release asset contract. |
| BUG-RE-11 | branch integration | Rebase/three-way port collaboration changes onto remote `main` 1.2.23 (`53959bb...`) before release review; the current branch is 224 commits behind. |
| BUG-RE-12 | `scripts/evidence-content-policy.mjs`, producer/validator workflows | Scan formal publish evidence text content before upload and after download; quality/structural/binary artifacts remain explicit residuals until their own scanner/OCR policy exists. |
| BUG-RE-13 | `scripts/verify-github-release-assets.mjs`, `.github/workflows/release.yml` | Publish only after an empty draft is reconciled by immutable release id, exact names/sizes/SHA-256 digests are verified, and tag target is checked before and after publication; publish the exact decision/manifest/installer snapshot, refuse stale or conflicting mutation, and allow only read-only convergence for the same owned published release. |

### Phase A.1 — Transaction and supply-chain hardening

| Area | File | Invariant |
| --- | --- | --- |
| Draft/release recovery | `scripts/mutate-github-release.mjs`, `scripts/inspect-github-release.mjs`, `scripts/reconcile-github-release-assets.mjs`, `scripts/upload-github-release-assets.mjs` | Discover drafts through authenticated list pagination; create/resume and publish through one release-id/marker transaction adapter; reconcile ambiguous POST/PATCH outcomes before any repeat mutation; clean only exact empty `starter` residues; stream missing assets through the release-id upload endpoint from `O_NOFOLLOW` stable file descriptors. |
| Durable decision | `.github/workflows/release.yml` | Preserve a bounded BLOCKED fallback until a schema-valid validator result is atomically installed; scan the exact uploaded snapshot. |
| Retry identity | `.github/workflows/release.yml`, producer workflows | Artifact names include stable `run_id`; same-run retries use explicit overwrite while downstream jobs continue to resolve successful artifacts from an earlier attempt. |
| Request bounds | `scripts/fetch-deadline.mjs`, `scripts/github-read-retry.mjs`, `scripts/github-api-base.mjs` | The Node release adapters validate the credential-bearing HTTPS API base, bound headers/error bodies, cap JSON bytes, and share one retry policy: transient statuses use short exponential backoff, explicit GitHub 403/429 rate limits honor `Retry-After` or `x-ratelimit-reset`, and missing hints use a one-minute fallback. A provider wait beyond the 60-second policy cap or the shared transaction budget is a structured fail-closed result; it is never truncated into an early retry. |
| Candidate trust | `.github/workflows/release.yml` | Unsigned candidate jobs never mint first-party attestations or release trust. |
| Runner provenance | `.github/workflows/collaboration-soak-release-evidence.yml`, `.github/workflows/linux-self-hosted-release.yml` | Protected boolean preflight is only a declaration; promotion must prove the actual JIT/online/one-shot runner identity. |
| Attestation identity | `.github/workflows/release.yml`, promotion controller | Parse attestation predicates and bind producer run/attempt plus controller identity to the target release source/tag; non-empty JSON is insufficient. |
| Publication writer | repository rulesets/environments | Enforce one protected promotion writer and immutable tag/release policy to close the final remote last-writer window. |

### Phase C — Validation and release parity

1. Run source contract, actionlint, script tests, plugin/Desktop/Rust suites.
2. Rebuild the deterministic bundle after all source and README changes.
3. Re-run structural and behavioral Gateway checks; retain honest open-gate status until full producers have passed.
4. Update docs and evidence hashes only from the final source snapshot.

## Stop conditions

- A producer cannot emit `PASS` evidence unless its required harness actually ran.
- Missing runner capabilities, candidate artifacts, or external source bindings are hard failures.
- A protected boolean runner declaration, an unparsed/non-empty attestation JSON, or an ungoverned concurrent release writer is not evidence of production readiness; each remains a hard stop until independently proven or protected by repository governance.
- Existing partial evidence remains explicitly partial; it is never copied into a full evidence location.
