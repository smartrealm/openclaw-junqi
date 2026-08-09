import {
  getWorkspacePath,
  readDir,
  readFilePreview,
  type FsEntry,
} from '@/workspace-files/runtime/workspaceFs';

const MEMORY_DIRECTORY_NAME = 'memory';
const PRIMARY_MEMORY_FILE_NAME = 'MEMORY.md';
const MAX_MEMORY_FILES = 200;
const MAX_MEMORY_DIRECTORY_DEPTH = 3;

export type OpenClawWorkspaceMemoryKind = 'primary' | 'journal';

export interface OpenClawWorkspaceMemoryItem {
  id: string;
  path: string;
  name: string;
  content: string;
  kind: OpenClawWorkspaceMemoryKind;
  recordedAt?: string;
}

export interface OpenClawWorkspaceMemorySnapshot {
  workspacePath: string;
  items: OpenClawWorkspaceMemoryItem[];
}

function isMemoryMarkdownFile(entry: FsEntry): boolean {
  return !entry.is_dir && entry.name.toLowerCase().endsWith('.md');
}

function pathForWorkspaceFile(workspacePath: string, fileName: string): string {
  const root = workspacePath.replace(/[\\/]+$/, '');
  return `${root}/${fileName}`;
}

function recordedAtFromMemoryFileName(fileName: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(?:\.md)?$/i.exec(fileName);
  if (!match) return undefined;
  const parsed = new Date(`${match[1]}T${match[2]}:${match[3]}:00`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

async function readMemoryItem(
  entry: Pick<FsEntry, 'name' | 'path'>,
  workspacePath: string,
  kind: OpenClawWorkspaceMemoryKind,
): Promise<OpenClawWorkspaceMemoryItem | null> {
  const preview = await readFilePreview(entry.path, workspacePath);
  if (preview.kind !== 'text' || !preview.text?.trim()) return null;
  return {
    id: entry.path,
    path: entry.path,
    name: entry.name,
    content: preview.text,
    kind,
    ...(recordedAtFromMemoryFileName(entry.name) ? { recordedAt: recordedAtFromMemoryFileName(entry.name) } : {}),
  };
}

async function collectJournalEntries(
  directoryPath: string,
  workspacePath: string,
  depth: number,
  collected: OpenClawWorkspaceMemoryItem[],
): Promise<void> {
  if (depth > MAX_MEMORY_DIRECTORY_DEPTH || collected.length >= MAX_MEMORY_FILES) return;
  const entries = await readDir(directoryPath, workspacePath);
  for (const entry of entries) {
    if (collected.length >= MAX_MEMORY_FILES) return;
    if (entry.is_dir) {
      await collectJournalEntries(entry.path, workspacePath, depth + 1, collected);
      continue;
    }
    if (!isMemoryMarkdownFile(entry)) continue;
    const item = await readMemoryItem(entry, workspacePath, 'journal');
    if (item) collected.push(item);
  }
}

/**
 * Reads the OpenClaw workspace memory contract without widening the file
 * boundary. The current installed OpenClaw documents `MEMORY.md` and
 * `<workspace>/memory/*.md` as its durable workspace-memory locations.
 */
export async function loadOpenClawWorkspaceMemory(): Promise<OpenClawWorkspaceMemorySnapshot> {
  const workspacePath = await getWorkspacePath();
  const items: OpenClawWorkspaceMemoryItem[] = [];
  const primaryEntry = {
    name: PRIMARY_MEMORY_FILE_NAME,
    path: pathForWorkspaceFile(workspacePath, PRIMARY_MEMORY_FILE_NAME),
  };

  try {
    const primary = await readMemoryItem(primaryEntry, workspacePath, 'primary');
    if (primary) items.push(primary);
  } catch {
    // MEMORY.md is optional in OpenClaw and may not exist in a new workspace.
  }

  try {
    const entries = await readDir(workspacePath, workspacePath);
    const memoryDirectory = entries.find((entry) => (
      entry.is_dir && entry.name.toLowerCase() === MEMORY_DIRECTORY_NAME
    ));
    if (memoryDirectory) {
      await collectJournalEntries(memoryDirectory.path, workspacePath, 1, items);
    }
  } catch (error) {
    if (items.length > 0) return { workspacePath, items };
    throw error;
  }

  return {
    workspacePath,
    items: items.sort((left, right) => (
      (right.recordedAt ?? '').localeCompare(left.recordedAt ?? '')
      || left.name.localeCompare(right.name)
    )),
  };
}
