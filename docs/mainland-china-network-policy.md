# Mainland China Network Policy

JunQi desktop releases must not make GitHub, npmjs.org, nodejs.org, the
Microsoft Store, or winget package sources the default runtime acquisition
path. When WebView2 is missing, the installer downloads Microsoft's small
bootstrapper and then uses its mainland CDN path instead of shipping an
offline bundle.

## Windows install contract

- The installer reuses the system WebView2 runtime. When it is missing, the
  installer downloads Microsoft's roughly 1.6–1.8 MB bootstrapper instead of
  embedding it or the roughly 127 MB offline runtime.
- Machines without WebView2 download it on demand from Microsoft's
  `msedge.sf.dl.delivery.mp.microsoft.com` distribution chain, which resolves
  through mainland CDN nodes; no third-party download site is used.
- A compatible system Node.js/Git installation is reused when available.
- Missing or incompatible Node.js uses the official Windows MSI and its
  vendor-selected standard installation directory. JunQi resolves a version
  from the active OpenClaw requirement, downloads the MSI through domestic
  mirrors, and verifies it with the publisher `SHASUMS256.txt`; it does not set
  a private installation directory. If the required MSI is unavailable for the
  current architecture or every domestic source fails, Windows Package Manager
  is a logged fallback rather than the default path.
- Missing Git uses the full Git for Windows installer and its standard
  installation directory. The reviewed installer version and SHA-256 are
  pinned in `resources/runtime-artifacts.json`, and downloads try npmmirror
  before Huawei Cloud. Windows Package Manager is used only after those
  validated domestic installer sources fail.
- An explicitly selected portable Node.js or Git directory uses the verified
  archive flow. It must be outside OpenClaw state, workspace, and internal
  runtime locations. Fresh installs never create or reuse a private Node.js or
  Git runtime beneath OpenClaw data.
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
