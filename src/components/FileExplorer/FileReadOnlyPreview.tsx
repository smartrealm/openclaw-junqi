import { invoke } from "@tauri-apps/api/core";
import { workspaceFilePreviewContent } from "@/file-preview/content";
import type { WorkspaceFilePreview } from "@/utils/filePreviewCapabilities";
import { FilePreviewSurface } from "./FilePreviewSurface";

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
  const openExternal = () => {
    void invoke("open_path_with_system_default", { path: filePath, projectPath });
  };

  return (
    <FilePreviewSurface
      content={workspaceFilePreviewContent(fileName, preview)}
      fileName={fileName}
      onOpenExternal={openExternal}
    />
  );
}
