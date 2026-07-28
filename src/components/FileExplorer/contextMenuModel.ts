import type { ContextMenuState } from "./types";

export type FileExplorerMenuAction =
  | "new-file"
  | "new-folder"
  | "open"
  | "rename"
  | "copy-path"
  | "copy-at-path"
  | "reveal"
  | "delete";

export function getFileExplorerMenuSections(
  target: Pick<ContextMenuState, "isDir" | "isRoot">,
): FileExplorerMenuAction[][] {
  const primary: FileExplorerMenuAction[] = ["new-file", "new-folder"];
  if (!target.isRoot && !target.isDir) primary.push("open");
  if (!target.isRoot) primary.push("rename");

  const pathActions: FileExplorerMenuAction[] = ["copy-path", "copy-at-path", "reveal"];
  return target.isRoot ? [primary, pathActions] : [primary, pathActions, ["delete"]];
}
