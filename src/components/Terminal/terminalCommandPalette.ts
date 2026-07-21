import type { Workspace } from '@/workspace/types';
import {
  TERMINAL_AGENT_LAUNCHERS,
  type TerminalAgentId,
} from './terminalAgentCatalog';
import type { TerminalSessionOverviewEntry } from './terminalSessionRegistry';

export interface TerminalPaletteRecentDirectory {
  path: string;
  name: string;
}

export type TerminalPaletteItem =
  | { id: string; title: string; subtitle: string; kind: 'workspace'; workspaceId: string }
  | { id: string; title: string; subtitle: string; kind: 'tab'; shellId: string }
  | { id: string; title: string; subtitle: string; kind: 'worktree'; workspaceId: string }
  | { id: string; title: string; subtitle: string; kind: 'agent'; agent: TerminalAgentId }
  | { id: string; title: string; subtitle: string; kind: 'terminal' }
  | { id: string; title: string; subtitle: string; kind: 'ssh' }
  | { id: string; title: string; subtitle: string; kind: 'recent'; path: string };

export interface BuildTerminalPaletteInput {
  workspaces: Workspace[];
  sessions: readonly TerminalSessionOverviewEntry[];
  availableAgents: readonly TerminalAgentId[];
  recentDirectories: readonly TerminalPaletteRecentDirectory[];
  worktreeWorkspaceIds: ReadonlySet<string>;
  workspaceDefaultLabel: string;
}

/** Kooky's subsequence matcher: prefix +10, word boundary +5, consecutive +3. */
export function fuzzyTerminalPaletteScore(query: string, text: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  const normalizedText = text.toLowerCase();
  let queryIndex = 0;
  let previousMatch = -2;
  let score = 0;

  for (let index = 0; index < normalizedText.length && queryIndex < normalizedQuery.length; index += 1) {
    if (normalizedText[index] !== normalizedQuery[queryIndex]) continue;
    score += 1;
    if (index === 0) score += 10;
    else if (' -_/ .'.includes(normalizedText[index - 1])) score += 5;
    if (index === previousMatch + 1) score += 3;
    previousMatch = index;
    queryIndex += 1;
  }

  return queryIndex === normalizedQuery.length ? score : -Infinity;
}

/**
 * Build a live Kooky-style index. The terminal session registry is the source
 * of tabs, so opening the palette cannot surface restored or already-closed
 * shell records.
 */
export function buildTerminalPaletteItems(input: BuildTerminalPaletteInput): TerminalPaletteItem[] {
  const workspaceById = new Map(input.workspaces.map((workspace) => [workspace.id, workspace]));
  const items: TerminalPaletteItem[] = [];

  for (const workspace of input.workspaces) {
    const title = workspace.name.trim() || input.workspaceDefaultLabel;
    items.push({
      id: `workspace:${workspace.id}`,
      title,
      subtitle: 'workspace',
      kind: 'workspace',
      workspaceId: workspace.id,
    });

    if (input.worktreeWorkspaceIds.has(workspace.id)) {
      items.push({
        id: `worktree:${workspace.id}`,
        title: `Create Worktree for ${title}`,
        subtitle: 'worktree',
        kind: 'worktree',
        workspaceId: workspace.id,
      });
    }

    for (const session of input.sessions) {
      if (session.workspaceId !== workspace.id) continue;
      items.push({
        id: `tab:${session.shellId}`,
        title: session.title,
        subtitle: `tab in ${title}`,
        kind: 'tab',
        shellId: session.shellId,
      });
    }
  }

  // A registry entry can outlive a workspace render for one React commit.
  // Keep it searchable in that short window instead of silently dropping a
  // live PTY jump.
  for (const session of input.sessions) {
    if (!session.workspaceId || workspaceById.has(session.workspaceId)) continue;
    items.push({
      id: `tab:${session.shellId}`,
      title: session.title,
      subtitle: 'tab',
      kind: 'tab',
      shellId: session.shellId,
    });
  }

  items.push({
    id: 'terminal',
    title: 'Open Terminal',
    subtitle: 'shell',
    kind: 'terminal',
  });
  const available = new Set(input.availableAgents);
  for (const agentId of input.availableAgents) {
    const agent = TERMINAL_AGENT_LAUNCHERS.find((candidate) => candidate.id === agentId);
    if (!agent || !available.has(agent.id)) continue;
    items.push({
      id: `agent:${agent.id}`,
      title: `Open ${agent.label}`,
      subtitle: 'agent',
      kind: 'agent',
      agent: agent.id,
    });
  }
  items.push({
    id: 'ssh',
    title: 'New SSH Workspace...',
    subtitle: 'workspace on a remote host',
    kind: 'ssh',
  });

  const openPaths = new Set(
    input.workspaces
      .filter((workspace) => !workspace.sshRemoteHost)
      .map((workspace) => workspace.worktreePath || workspace.projectDirectory || workspace.workingDirectory),
  );
  for (const directory of input.recentDirectories) {
    if (openPaths.has(directory.path)) continue;
    items.push({
      id: `recent:${directory.path}`,
      title: directory.name,
      subtitle: `recent · ${directory.path}`,
      kind: 'recent',
      path: directory.path,
    });
  }
  return items;
}

/** Match and cap results exactly like Kooky's command-palette window. */
export function matchTerminalPaletteItems(
  query: string,
  items: readonly TerminalPaletteItem[],
  limit = 20,
): TerminalPaletteItem[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((item) => {
      const titleScore = fuzzyTerminalPaletteScore(query, item.title);
      const subtitleScore = titleScore === -Infinity
        ? fuzzyTerminalPaletteScore(query, item.subtitle) / 2
        : titleScore;
      return { item, score: subtitleScore };
    })
    .filter((entry) => entry.score > -Infinity)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}
