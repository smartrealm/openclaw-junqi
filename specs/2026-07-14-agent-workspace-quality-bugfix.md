# Agent workspace quality bugfix

## BUG-01 · Stable workspace resolution

**Current**: Workspace resolution depends on the agents array identity and clears the editor on refresh.

**Target**: Resolve from the selected agent's workspace string and only reset editor state when the effective root changes.

**Acceptance**: Replacing the agents array with the same workspace does not clear the open file.

## BUG-02 · Dirty close guard

**Current**: The workspace close button invokes `onClose` directly.

**Target**: Closing a dirty file uses the same application confirmation flow as switching files.

**Acceptance**: Cancel preserves the editor; confirm closes it.

## BUG-03 · Latest file request wins

**Current**: Any completed read updates the editor.

**Target**: Only the most recent file request may update loading or open-file state.

**Acceptance**: A slow earlier read cannot replace a later selection.

## BUG-04 · Persist Agent skills

**Current**: Wizard selections are discarded after `agents.create`.

**Target**: After creation, non-empty selections are persisted to the native OpenClaw `agents.list[].skills` allowlist using the latest disk config. Status parsing uses `agentSkillFilter` and includes local workspace skills when no explicit filter exists.

**Acceptance**: The matching config entry contains selected skill keys, unrelated config is preserved, and the parser excludes unrelated shared skills.

## BUG-05 · AI workspace back navigation

**Current**: The root AI workspace has neither a local nor route-level back action.

**Target**: TopBar provides history-aware back navigation with `/tools` fallback.

**Acceptance**: AI workspace is included in `showRouteBack` and uses `/tools` fallback.

## BUG-06 · Skill load failure state

**Current**: Gateway failure becomes an empty skill list.

**Target**: Failure has an explicit error state and retry action.

**Acceptance**: The drawer never labels a failed request as a valid empty workspace.
