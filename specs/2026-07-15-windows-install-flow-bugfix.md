# Windows Installation Flow Bugfix Specification

Date: 2026-07-15

## Acceptance Contracts

### BUG-WIN-INSTALL-01

Windows registry environment variables are expanded, existing process PATH
entries survive refresh, and entries are deduplicated case-insensitively.

### BUG-WIN-INSTALL-02

OpenClaw package and launcher activation either completes fully or restores the
previous installation. A process restart detects and recovers a persisted
interrupted transaction before another promotion begins.

### BUG-WIN-INSTALL-03

Tagged Windows releases cannot build without a code-signing certificate. Every
published EXE/MSI must have a valid Authenticode signature and timestamp.

### BUG-WIN-INSTALL-04

JunQi resolves the real winget executable before use. When unavailable, setup
identifies App Installer and manual Node/Git installation as recovery paths and
rechecks dependencies on retry.

### BUG-WIN-INSTALL-05

No renderer-accessible command can install an arbitrary winget package ID.

### BUG-WIN-INSTALL-06

Reinstall replaces the detected npm package in place. Installations owned by a
different package manager fail with explicit guidance and never create an
unannounced second copy.
