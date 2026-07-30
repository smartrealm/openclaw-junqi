import { useMemo, useState } from 'react';
import { FileQuestion, FileText, Plus } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { showConfirm } from '@/components/shared/AlertDialog';
import { debugError } from '@/utils/debugLog';
import { useAgentWorkspaceStore } from '@/stores/agentWorkspaceStore';
import { useFocusContextStore } from '@/stores/focusContextStore';
import { useTaskBriefStore } from '@/stores/taskBriefStore';
import { checkTaskBrief } from '@/task-briefs/checker';
import { compileTaskBrief } from '@/task-briefs/compiler';
import { handoffTaskBrief } from '@/task-briefs/handoff';
import { taskBriefPromptLabels } from '@/task-briefs/promptLabels';
import type { TaskBriefCardKind, TaskBriefReferenceKind } from '@/task-briefs/domain';
import { createEmptyTaskBriefCard } from './TaskBriefCardsSection';
import { TaskBriefEditor } from './TaskBriefEditor';
import { TaskBriefList } from './TaskBriefList';
import { createEmptyTaskBriefReference } from './TaskBriefReferencesSection';
import { TaskBriefToolbar } from './TaskBriefToolbar';
import './task-briefs.css';
import './task-briefs-editor.css';
import './task-briefs-feedback.css';

export function TaskBriefsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const briefs = useTaskBriefStore((state) => state.briefs);
  const selectedBriefId = useTaskBriefStore((state) => state.selectedBriefId);
  const [preview, setPreview] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const requestedBriefId = params.get('brief');
  const activeBriefId = requestedBriefId ?? selectedBriefId;
  const brief = briefs.find((candidate) => candidate.id === activeBriefId) ?? null;
  const requestedBriefMissing = requestedBriefId !== null && brief === null;
  const findings = useMemo(() => brief ? checkTaskBrief(brief) : [], [brief]);
  const promptLabels = useMemo(() => taskBriefPromptLabels((key) => t(key)), [t]);
  const compiledPrompt = useMemo(
    () => brief ? compileTaskBrief(brief, promptLabels) : '',
    [brief, promptLabels],
  );
  const launchBlocked = brief === null || findings.some((finding) => finding.severity === 'error');

  const selectBrief = (briefId: string) => {
    useTaskBriefStore.getState().selectBrief(briefId);
    setParams({ brief: briefId });
    setPreview(false);
    setLaunchError(null);
  };

  const createBrief = () => {
    const created = useTaskBriefStore.getState().createBrief();
    selectBrief(created.id);
  };

  const focusBrief = () => {
    if (!brief) return;
    useFocusContextStore.getState().setFocus({
      schemaVersion: 1,
      target: { kind: 'task-brief', id: brief.id },
      title: brief.title || t('taskBriefs.untitled'),
      detail: brief.projectPath,
      route: `/briefs?brief=${encodeURIComponent(brief.id)}`,
      focusedAt: Date.now(),
    });
  };

  const launchBrief = () => {
    if (!brief) return;
    const latestBrief = useTaskBriefStore.getState().briefs.find((candidate) => candidate.id === brief.id);
    if (!latestBrief) {
      setLaunchError(t('taskBriefs.launchUnavailable'));
      return;
    }
    try {
      const result = handoffTaskBrief(latestBrief, {
        createTask: useAgentWorkspaceStore.getState().createTask,
        findTaskBySourceBriefId: (briefId) => useAgentWorkspaceStore.getState().tasks
          .find((task) => task.sourceBriefId === briefId) ?? null,
        markLaunched: useTaskBriefStore.getState().markLaunched,
        setFocus: useFocusContextStore.getState().setFocus,
        promptLabels,
      });
      setLaunchError(null);
      navigate(result.route);
    } catch (error) {
      debugError('app', 'Task Brief handoff failed', error);
      setLaunchError(t('taskBriefs.launchFailed'));
    }
  };

  const deleteBrief = () => {
    if (!brief) return;
    showConfirm(
      t('taskBriefs.deleteBrief'),
      t('taskBriefs.deleteBriefConfirm', { title: brief.title || t('taskBriefs.untitled') }),
      () => useTaskBriefStore.getState().removeBrief(brief.id),
    );
  };

  return (
    <div className="junqi-briefs-shell">
      <TaskBriefList
        briefs={briefs}
        selectedBriefId={brief?.id ?? null}
        onCreate={createBrief}
        onSelect={selectBrief}
      />

      {!brief ? (
        <main className="junqi-briefs-empty">
          {requestedBriefMissing ? <FileQuestion size={44} /> : <FileText size={44} />}
          <strong>{t(requestedBriefMissing ? 'taskBriefs.unavailableTitle' : 'taskBriefs.emptyTitle')}</strong>
          <span>{t(requestedBriefMissing ? 'taskBriefs.unavailableBody' : 'taskBriefs.emptyBody')}</span>
          {!requestedBriefMissing && (
            <button type="button" onClick={createBrief}>
              <Plus size={15} />
              {t('taskBriefs.new')}
            </button>
          )}
        </main>
      ) : (
        <main className="junqi-briefs-editor">
          <TaskBriefToolbar
            brief={brief}
            preview={preview}
            launchBlocked={launchBlocked}
            onArchiveChange={(archived) => useTaskBriefStore.getState().setBriefArchived(brief.id, archived)}
            onFocus={focusBrief}
            onLaunch={launchBrief}
            onTogglePreview={() => setPreview((value) => !value)}
          />
          <TaskBriefEditor
            brief={brief}
            compiledPrompt={compiledPrompt}
            findings={findings}
            launchError={launchError}
            preview={preview}
            onAddCard={(kind: TaskBriefCardKind) => useTaskBriefStore.getState()
              .addCard(brief.id, createEmptyTaskBriefCard(kind))}
            onAddReference={(kind: TaskBriefReferenceKind) => useTaskBriefStore.getState()
              .addReference(brief.id, createEmptyTaskBriefReference(kind))}
            onDelete={deleteBrief}
            onMoveCard={(cardId, direction) => useTaskBriefStore.getState().moveCard(brief.id, cardId, direction)}
            onRemoveCard={(cardId) => useTaskBriefStore.getState().removeCard(brief.id, cardId)}
            onRemoveReference={(referenceId) => useTaskBriefStore.getState().removeReference(brief.id, referenceId)}
            onUpdateBrief={(patch) => useTaskBriefStore.getState().updateBrief(brief.id, patch)}
            onUpdateCard={(cardId, content) => useTaskBriefStore.getState().updateCard(brief.id, cardId, { content })}
            onUpdateReference={(referenceId, patch) => useTaskBriefStore.getState()
              .updateReference(brief.id, referenceId, patch)}
          />
        </main>
      )}
    </div>
  );
}
