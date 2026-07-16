# Mainland China Network Policy

JunQi desktop releases must complete first installation without access to
GitHub, npmjs.org, nodejs.org, the Microsoft Store, or winget package sources.

## Windows install contract

- WebView2 is bundled with the installer through `offlineInstaller` mode.
- A compatible system Node.js/Git installation is reused when available.
- Missing or incompatible Node.js is installed as a user-scoped portable
  runtime from npmmirror. The archive is verified against the publisher's
  `SHASUMS256.txt` before activation.
- Missing Git is installed as user-scoped MinGit from npmmirror. The version and
  publisher SHA-256 values are pinned in `commands/git_runtime.rs`.
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
