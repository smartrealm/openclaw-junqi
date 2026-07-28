import { lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, FileWarning, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "@/utils/format";
import { imageDataUrl, type WorkspaceFilePreview } from "@/utils/filePreviewCapabilities";

const PdfPreview = lazy(() =>
  import("./PdfPreview").then((module) => ({ default: module.PdfPreview })),
);

export function FileReadOnlyPreview({
  preview,
  fileName,
  filePath,
  projectPath,
}: {
  preview: Exclude<WorkspaceFilePreview, { kind: "text" }>;
  fileName: string;
  filePath: string;
  projectPath: string;
}) {
  const { t } = useTranslation();
  const openExternal = () => {
    void invoke("open_path_with_system_default", { path: filePath, projectPath });
  };

  if (preview.kind === "image") {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 overflow-auto p-6">
        <img
          src={imageDataUrl(preview)}
          alt={fileName}
          className="max-h-full max-w-full rounded border border-[rgb(var(--aegis-overlay)/0.1)] object-contain"
          draggable={false}
        />
        <span className="shrink-0 text-[10px] text-aegis-text-dim">
          {preview.mimeType} · {formatBytes(preview.byteLength)}
        </span>
      </div>
    );
  }

  if (preview.kind === "pdf") {
    return (
      <Suspense
        fallback={(
          <div className="flex h-full items-center justify-center text-aegis-text-dim">
            <Loader2 size={18} className="animate-spin" />
          </div>
        )}
      >
        <PdfPreview base64={preview.base64} onOpenExternal={openExternal} />
      </Suspense>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-aegis-text-dim">
      <FileWarning size={28} className="opacity-45" />
      <div>
        <p className="text-[12px] font-medium text-aegis-text-muted">
          {t("file.binaryCannotPreview", "Binary file cannot be previewed")}
        </p>
        <p className="mt-1 text-[10px]">{formatBytes(preview.byteLength)}</p>
      </div>
      <button
        type="button"
        onClick={openExternal}
        className="flex items-center gap-1.5 rounded border border-[rgb(var(--aegis-overlay)/0.1)] px-3 py-1.5 text-[11px] text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text"
      >
        <ExternalLink size={12} />
        {t("file.openExternal", "Open with system app")}
      </button>
    </div>
  );
}
