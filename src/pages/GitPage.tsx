// ── GitPage — standalone git management page ──────────────────────────────────
// Provides working-tree changes view for a project path.
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { GitChanges, GitDiffViewer } from "@/components/Git";

function getProjectPath(): string {
  // Try to infer the project path from the app's working directory
  if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
    // Running in Tauri; try reading the cwd from localStorage
    try {
      const stored = localStorage.getItem("git-project-path");
      if (stored) return stored;
    } catch {}
  }
  // Fallback to current directory from document
  return "";
}

function setProjectPath(path: string) {
  try {
    localStorage.setItem("git-project-path", path);
  } catch {}
}

export default function GitPage() {
  const { t } = useTranslation();
  const [projectPath, setProjectPathState] = useState(getProjectPath);
  const [pathInput, setPathInput] = useState(projectPath);
  const [diffView, setDiffView] = useState<{
    filePath: string;
    staged: boolean;
    label: string;
  } | null>(null);

  const handleSetPath = useCallback(() => {
    const trimmed = pathInput.trim();
    setProjectPath(trimmed);
    setProjectPathState(trimmed);
  }, [pathInput]);

  const handleFileSelect = useCallback(
    (filePath: string, staged: boolean, label: string) => {
      setDiffView({ filePath, staged, label });
    },
    [],
  );

  const handleCloseDiff = useCallback(() => {
    setDiffView(null);
  }, []);

  if (!projectPath) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: 16,
          color: "var(--aegis-text)",
          padding: 40,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 650, margin: 0 }}>{t('gitPage.title', 'Git Management')}</h2>
        <p style={{ fontSize: 13, color: "var(--aegis-text-dim)", margin: 0 }}>
          {t('gitPage.pathPrompt', 'Enter a project path to view and manage its git repository.')}
        </p>
        <div style={{ display: "flex", gap: 8, width: 400 }}>
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSetPath(); }}
            placeholder={t('gitPage.pathPlaceholder', '/path/to/your/project')}
            style={{
              flex: 1,
              padding: "8px 14px",
              background: "var(--aegis-input)",
              border: "1px solid var(--aegis-border)",
              borderRadius: 8,
              color: "var(--aegis-text)",
              fontSize: 13,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleSetPath}
            style={{
              padding: "8px 20px",
              background: "rgb(var(--aegis-accent))",
              color: "var(--aegis-btn-primary-text)",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t('gitPage.open', 'Open')}
          </button>
        </div>
      </div>
    );
  }

  if (diffView) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        <GitDiffViewer
          projectPath={projectPath}
          mode="file"
          filePath={diffView.filePath}
          staged={diffView.staged}
          title={diffView.label}
          onClose={handleCloseDiff}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        overflow: "hidden",
        background: "var(--aegis-bg)",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--aegis-text-dim)",
          fontSize: 13,
          gap: 8,
        }}
      >
        <span>{t('gitPage.selectFile', 'Select a file from the Changes panel to view its diff.')}</span>
        <span style={{ fontSize: 12, color: "var(--aegis-text-dim)" }}>
          {t('gitPage.project', 'Project')}: {projectPath}
        </span>
      </div>
      <GitChanges
        projectPath={projectPath}
        currentTaskCreatedAt={null}
        onFileSelect={handleFileSelect}
        width={320}
      />
    </div>
  );
}
