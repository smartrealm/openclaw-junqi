# Mainland China Network Policy

JunQi desktop releases must avoid runtime downloads from GitHub, npmjs.org,
nodejs.org, the Microsoft Store, or winget package sources. WebView2 uses the
small Microsoft bootstrapper and its mainland CDN path instead of an offline bundle.

## Windows install contract

- The installer reuses the system WebView2 runtime and embeds only Microsoft's
  roughly 1.6–1.8 MB bootstrapper, not the roughly 127 MB offline runtime.
- Machines without WebView2 download it on demand from Microsoft's
  `msedge.sf.dl.delivery.mp.microsoft.com` distribution chain, which resolves
  through mainland CDN nodes; no third-party download site is used.
- A compatible system Node.js/Git installation is reused when available.
- Missing or incompatible Node.js is installed as a user-scoped portable
  runtime. Downloads try npmmirror, Alibaba Cloud, Tencent Cloud, USTC, Nanjing
  University, and Huawei Cloud without contacting nodejs.org. The version index,
  archive, and mirrored publisher `SHASUMS256.txt` share one source priority
  list, and the archive digest is verified before activation.
- Missing Git is installed as user-scoped MinGit from npmmirror, then Huawei
  Cloud. The reviewed version and publisher SHA-256 values are pinned in
  `commands/git_runtime.rs`; end-user installation does not request GitHub.
- OpenClaw package metadata and tarballs use npmmirror first. npmjs.org is only
  a fallback for users whose network permits it.
- Runtime replacement is staged and transactional; a failed validation does not
  replace the working runtime.

## Release and updates

SignPath runs only in release CI. End-user machines never contact SignPath.
GitHub Releases may remain a developer distribution channel, but must not be the
only channel advertised to mainland users.

The built-in desktop updater intentionally has no default endpoint until a
mainland-hosted HTTPS endpoint and artifact store are provisioned. Enabling it
requires hosting `latest.json` and every signed artifact URL in that manifest on
the mainland-accessible service; Tauri signatures remain mandatory.
