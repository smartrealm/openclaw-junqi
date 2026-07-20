export const OPENCLAW_COMMAND_CATEGORIES = [
  'setup',
  'gateway',
  'diagnostics',
  'models',
  'auth',
  'channels',
  'automation',
] as const;

export type OpenClawCommandCategory = typeof OPENCLAW_COMMAND_CATEGORIES[number];

export type OpenClawCommandImpact = 'read' | 'live' | 'action' | 'mixed';

export interface OpenClawCommandReference {
  id: string;
  category: OpenClawCommandCategory;
  command: string;
  copyCommand?: string;
  summaryKey: string;
  docsUrl: string;
  impact: OpenClawCommandImpact;
  keywords: readonly string[];
}
