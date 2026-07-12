export const FILE_TREE_POINTER_DRAG_EVENT = "junqi:file-tree-pointer-drag";

export interface FileTreePointerDragDetail {
  type: "drop" | "cancel";
  paths: string[];
  x: number;
  y: number;
}

export function dispatchFileTreePointerDrag(
  detail: FileTreePointerDragDetail,
  target: EventTarget = window,
): void {
  target.dispatchEvent(new CustomEvent<FileTreePointerDragDetail>(FILE_TREE_POINTER_DRAG_EVENT, { detail }));
}
