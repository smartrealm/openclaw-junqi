import { useNavigate } from 'react-router-dom';
import {
  WelcomePage,
  type CLITool,
  type WorkspaceProject,
} from '@/components/shared/WelcomePage';
import { enqueueTerminalCommand } from '@/services/terminalCommandQueue';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { debugWarn } from '@/utils/debugLog';
import { findWorkspaceForDirectory } from '@/workspace/projectWorkspace';
import { initProjectConfig, openTerminalWorkspaceDirectory } from '@/api/tauri-commands';

export default function WelcomePageView() {
  const navigate = useNavigate();

  return (
    <WelcomePage
      onOpenProject={async (project: WorkspaceProject) => {
        const directory = await openTerminalWorkspaceDirectory(project.path);
        const store = useWorkspaceStore.getState();
        const existing = findWorkspaceForDirectory(store.workspaces, directory.path);
        if (existing) {
          store.setActive(existing.id);
        } else {
          store.createWorkspace(directory.name, directory.path);
        }

        void initProjectConfig(directory.path).catch((error) => {
          debugWarn('app', '[WelcomePageView] project config initialization failed', error);
        });
        navigate('/terminal');
      }}
      onLaunchTool={(tool: CLITool) => {
        enqueueTerminalCommand({ command: tool.cmd });
        navigate('/terminal');
      }}
    />
  );
}
