import { createWorkspaceSidebarChannel, type WorkspaceSidebarMode } from './workspaceSidebarChannel';

const channel = createWorkspaceSidebarChannel('agent-workspace');

export const AGENT_WORKSPACE_SIDEBAR_TOGGLE_EVENT = channel.toggleEvent;
export const AGENT_WORKSPACE_SIDEBAR_MODE_EVENT = channel.modeEvent;
export const AGENT_WORKSPACE_SIDEBAR_STORAGE_KEY = channel.storageKey;

export const readAgentWorkspaceSidebarMode = (): WorkspaceSidebarMode => channel.read();
export const requestAgentWorkspaceSidebarToggle = (): void => channel.requestToggle();
export const publishAgentWorkspaceSidebarMode = (mode: WorkspaceSidebarMode): void => channel.publish(mode);
