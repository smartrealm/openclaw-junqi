// ═══════════════════════════════════════════════════════════
// WelcomePageView — wraps shared WelcomePage with route-level concerns.
// Tool launch now navigates to /agent-run with pre-filled agent + a default
// prompt derived from the tool label, so the user can hit Run and the
// agent_task_pty backend spawns a real PTY.
// ═══════════════════════════════════════════════════════════

import { WelcomePage } from '@/components/shared';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface CLITool {
  id: string;
  label: string;
  icon: React.ReactNode;
  cmd: string;
}

function defaultPromptForTool(tool: CLITool): string {
  // Reasonable starting prompts per agent — the user can edit before Run.
  switch (tool.id) {
    case 'claude':
    case 'claude-code':
      return 'List the files in the current directory and summarize what each one does.';
    case 'codex':
      return 'Read the project README and suggest three concrete improvements.';
    default:
      return `Use ${tool.label} to look around and report what you find.`;
  }
}

export default function WelcomePageView() {
  const navigate = useNavigate();

  return (
    <WelcomePage
      onLaunchTool={(tool: CLITool) => {
        const params = new URLSearchParams({
          agent: tool.id === 'codex' ? 'codex' : 'claude',
          prompt: defaultPromptForTool(tool),
        });
        navigate(`/agent-run?${params.toString()}`);
      }}
    />
  );
}