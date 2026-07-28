import { MarkdownPreview } from '@/components/FileExplorer/MarkdownPreview';

async function openManagedMarkdownLink(href: string): Promise<void> {
  const openManagedPath = window.aegis?.managedFiles?.open || window.aegis?.uploads?.open;
  const isLocalPath = href.startsWith('/')
    || href.startsWith('~/')
    || /^[A-Za-z]:[\\/]/.test(href)
    || href.startsWith('file://');

  if (isLocalPath && openManagedPath) {
    await openManagedPath(href);
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}

export function FileMarkdownPreview({ content }: { content: string }) {
  return (
    <MarkdownPreview
      content={content}
      className="md-preview h-full overflow-auto"
      onOpenLocalLink={openManagedMarkdownLink}
    />
  );
}
