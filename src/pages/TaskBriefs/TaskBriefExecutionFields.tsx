import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { debugError } from '@/utils/debugLog';
import { TASK_BRIEF_TEXT_LIMITS, type TaskBrief } from '@/task-briefs/domain';
import type { TaskBriefEditablePatch } from '@/stores/taskBriefStore';

interface TaskBriefExecutionFieldsProps {
  brief: TaskBrief;
  disabled: boolean;
  onUpdate: (patch: TaskBriefEditablePatch) => void;
}

const AGENTS = ['claude', 'codex', 'pi'] as const;
const PERMISSIONS = [
  { value: 'ask', labelKey: 'agent.perm.ask' },
  { value: 'auto_edit', labelKey: 'agent.perm.auto' },
  { value: 'full_access', labelKey: 'agent.perm.full' },
] as const;
const LAUNCH_MODES = [
  { value: 'local', labelKey: 'agent.launch.local' },
  { value: 'worktree', labelKey: 'agent.launch.worktree' },
] as const;

export function TaskBriefExecutionFields({ brief, disabled, onUpdate }: TaskBriefExecutionFieldsProps) {
  const { t } = useTranslation();
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  const chooseProject = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: brief.projectPath || undefined,
        title: t('taskBriefs.chooseProject'),
      });
      if (typeof selected === 'string' && selected.trim()) {
        onUpdate({ projectPath: selected });
        setDirectoryError(null);
      }
    } catch (error) {
      debugError('app', 'Failed to select a Task Brief project directory', error);
      setDirectoryError(t('taskBriefs.projectPickerFailed'));
    }
  };

  return (
    <fieldset className="junqi-briefs-meta" disabled={disabled}>
      <label className="is-wide">
        <span>{t('taskBriefs.name')}</span>
        <input
          value={brief.title}
          maxLength={TASK_BRIEF_TEXT_LIMITS.title}
          onChange={(event) => onUpdate({ title: event.target.value })}
        />
      </label>

      <label className="is-project is-wide">
        <span>{t('taskBriefs.projectPath')}</span>
        <span className="junqi-briefs-input-action">
          <input
            value={brief.projectPath}
            maxLength={TASK_BRIEF_TEXT_LIMITS.projectPath}
            onChange={(event) => onUpdate({ projectPath: event.target.value })}
          />
          <button type="button" onClick={() => void chooseProject()} title={t('taskBriefs.chooseProject')}>
            <FolderOpen size={14} />
          </button>
        </span>
        {directoryError && <small role="alert">{directoryError}</small>}
      </label>

      <label>
        <span>{t('taskBriefs.agent')}</span>
        <select value={brief.agent} onChange={(event) => onUpdate({ agent: event.target.value as TaskBrief['agent'] })}>
          {AGENTS.map((agent) => <option key={agent} value={agent}>{t(`agent.${agent}`)}</option>)}
        </select>
      </label>

      <label>
        <span>{t('taskBriefs.permission')}</span>
        <select
          value={brief.permissionMode}
          onChange={(event) => onUpdate({ permissionMode: event.target.value as TaskBrief['permissionMode'] })}
        >
          {PERMISSIONS.map((permission) => (
            <option key={permission.value} value={permission.value}>{t(permission.labelKey)}</option>
          ))}
        </select>
      </label>

      <label>
        <span>{t('taskBriefs.launchMode')}</span>
        <select
          value={brief.launchMode}
          onChange={(event) => onUpdate({ launchMode: event.target.value as TaskBrief['launchMode'] })}
        >
          {LAUNCH_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>{t(mode.labelKey)}</option>
          ))}
        </select>
      </label>

      <label className="junqi-briefs-checkbox">
        <input
          type="checkbox"
          checked={brief.planMode}
          onChange={(event) => onUpdate({ planMode: event.target.checked })}
        />
        <span>{t('taskBriefs.planMode')}</span>
      </label>

      {brief.launchMode === 'worktree' && (
        <label>
          <span>{t('taskBriefs.baseBranch')}</span>
          <input
            value={brief.baseBranch ?? ''}
            maxLength={512}
            onChange={(event) => onUpdate({ baseBranch: event.target.value })}
          />
        </label>
      )}
    </fieldset>
  );
}
