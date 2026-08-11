import type { PDFDocumentProxy } from "pdfjs-dist";

type CleanupablePdfDocument = Pick<PDFDocumentProxy, "cleanup">;

/**
 * 释放 PDF.js 文档缓存。加载任务负责中止请求，文档实例只负责清理已加载资源。
 */
export async function releasePdfDocument(document: CleanupablePdfDocument): Promise<void> {
  try {
    await document.cleanup();
  } catch {
    // 清理失败不能覆盖原有的加载或渲染结果。
  }
}
