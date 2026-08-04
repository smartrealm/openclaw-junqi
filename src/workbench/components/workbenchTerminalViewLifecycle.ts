export interface WorkbenchTerminalViewResources {
  readonly observer: { disconnect: () => void };
  readonly subscription: { dispose: () => void } | null;
  readonly input: { dispose: () => void };
  readonly resize: { dispose: () => void };
  readonly terminal: { dispose: () => void };
}

export function detachWorkbenchTerminalView(resources: WorkbenchTerminalViewResources): void {
  resources.observer.disconnect();
  resources.subscription?.dispose();
  resources.input.dispose();
  resources.resize.dispose();
  resources.terminal.dispose();
}
