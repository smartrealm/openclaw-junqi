// ═══════════════════════════════════════════════════════════
// SkillHubManager — minimal Skill Hub view ported from junqi
//
// Wires to the backend commands added in commands/skills.rs:
//   - get_skill_hub_config / set_skill_hub_path / clear_skill_hub
//   - list_skills / list_skill_installations
//   - install_skill / delete_skill
//
// Why minimal: junqi already has SkillsPage/index.tsx (2k lines, gateway-based).
// This page is a *companion* view that exercises the new junqi-style fs/symlink
// backend so the wiring stays valid. UI is deliberately plain so it doesn't
// compete with the gateway-based SkillsPage.
// ═══════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import {
  Blocks, FolderOpen, Trash2, Plus, AlertTriangle, Loader2,
  CheckCircle2, XCircle, Link2, Settings, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SkillHubConfig {
  hubProjectId?: string | null;
  hubPath?: string | null;
  createdAt?: number | null;
}

interface Skill {
  name: string;
  displayName?: string;
  description?: string;
  path: string;
  hasError?: string;
}

interface SkillInstallation {
  skillName: string;
  projectId: string;
  agent: string;
  installedAt: number;
  linkPath: string;
  targetPath: string;
  health?: string;
}

interface SkillConflict {
  existingKind: string;
  existingTarget?: string | null;
  linkPath: string;
}

interface InstallResult {
  ok: boolean;
  conflict?: SkillConflict | null;
  alreadyInstalled?: boolean;
  skipped?: boolean;
  cancelled?: boolean;
  installation?: SkillInstallation | null;
}

interface DeleteResult {
  ok: boolean;
  removedLinks: number;
}

function healthColor(h: string | undefined): string {
  switch (h) {
    case 'ok': return 'text-aegis-success';
    case 'broken': return 'text-aegis-danger';
    case 'diverged': return 'text-aegis-warning';
    default: return 'text-aegis-text-dim';
  }
}

function healthIcon(h: string | undefined) {
  switch (h) {
    case 'ok': return <CheckCircle2 size={12} />;
    case 'broken':
    case 'diverged': return <XCircle size={12} />;
    default: return <Loader2 size={12} className="opacity-50" />;
  }
}

export function SkillHubManager() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<SkillHubConfig | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [installations, setInstallations] = useState<SkillInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hubInput, setHubInput] = useState('');
  const [targetProjectId, setTargetProjectId] = useState('');
  const [targetAgent, setTargetAgent] = useState<'claude' | 'codex'>('claude');
  const [pending, setPending] = useState(false);
  const [manageSkill, setManageSkill] = useState<Skill | null>(null);
  const [manageInstallations, setManageInstallations] = useState<SkillInstallation[]>([]);
  const [manageProject, setManageProject] = useState('');
  const [manageAgent, setManageAgent] = useState<'claude' | 'codex'>('claude');
  const [installConflict, setInstallConflict] = useState<{
    skill: Skill;
    projectId: string;
    agent: 'claude' | 'codex';
    conflict: SkillConflict;
    refreshManage: boolean;
  } | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, list, ins] = await Promise.all([
        invoke<SkillHubConfig>('get_skill_hub_config'),
        invoke<Skill[]>('list_skills'),
        invoke<SkillInstallation[]>('list_skill_installations', { skillName: null }),
      ]);
      setConfig(cfg);
      setHubInput(cfg.hubPath ?? '');
      setSkills(list);
      setInstallations(ins);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const installationBySkill = useMemo(() => {
    const map = new Map<string, SkillInstallation[]>();
    for (const i of installations) {
      const arr = map.get(i.skillName) ?? [];
      arr.push(i);
      map.set(i.skillName, arr);
    }
    return map;
  }, [installations]);

  const handleSetHub = async () => {
    if (!hubInput.trim()) return;
    setPending(true);
    setError(null);
    try {
      await invoke('set_skill_hub_path', { path: hubInput.trim() });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };

  const handleClearHub = async () => {
    setPending(true);
    setError(null);
    try {
      await invoke('clear_skill_hub');
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };

  const requestInstall = async (
    skill: Skill,
    projectId: string,
    agent: 'claude' | 'codex',
    refreshManage: boolean,
  ) => {
    if (!projectId.trim()) {
      setError('Set a target project ID first');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await invoke<InstallResult>('install_skill', {
        skillName: skill.name,
        skillPath: skill.path,
        projectId: projectId.trim(),
        agent,
        strategy: 'detect',
      });
      if (res.conflict) {
        setInstallConflict({ skill, projectId: projectId.trim(), agent, conflict: res.conflict, refreshManage });
        return;
      }
      if (!res.ok) {
        setError('Install failed');
        return;
      }
      await refresh();
      if (refreshManage) {
        const next = await invoke<SkillInstallation[]>('list_skill_installations', { skillName: skill.name });
        setManageInstallations(next);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };

  const handleInstall = (skill: Skill) => requestInstall(skill, targetProjectId, targetAgent, false);

  const handleDelete = async (skill: Skill) => {
    const accepted = await confirm(`Delete skill "${skill.displayName ?? skill.name}" and remove all of its project links?`, {
      title: 'Delete skill',
      kind: 'warning',
    });
    if (!accepted) return;
    setPending(true);
    setError(null);
    try {
      await invoke<DeleteResult>('delete_skill', {
        skillName: skill.name,
        skillPath: skill.path,
      });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };

  const handleOpenManage = async (skill: Skill) => {
    setManageSkill(skill);
    setManageProject('');
    setManageAgent('claude');
    try {
      const ins = await invoke<SkillInstallation[]>('list_skill_installations', { skillName: skill.name });
      setManageInstallations(ins);
    } catch { setManageInstallations([]); }
  };

  const handleManageInstall = async () => {
    if (!manageSkill || !manageProject.trim()) return;
    await requestInstall(manageSkill, manageProject, manageAgent, true);
  };

  const resolveInstallConflict = async (strategy: 'skip' | 'overwrite' | 'cancel') => {
    const pendingConflict = installConflict;
    if (!pendingConflict) return;
    setInstallConflict(null);
    if (strategy === 'cancel') return;
    setPending(true);
    setError(null);
    try {
      const result = await invoke<InstallResult>('install_skill', {
        skillName: pendingConflict.skill.name,
        skillPath: pendingConflict.skill.path,
        projectId: pendingConflict.projectId,
        agent: pendingConflict.agent,
        strategy,
      });
      if (!result.ok) {
        setError('Install conflict could not be resolved');
        return;
      }
      await refresh();
      if (pendingConflict.refreshManage) {
        const next = await invoke<SkillInstallation[]>('list_skill_installations', { skillName: pendingConflict.skill.name });
        setManageInstallations(next);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setPending(false);
    }
  };

  const handleManageRemove = async (ins: SkillInstallation) => {
    setPending(true);
    try {
      await invoke('uninstall_skill', {
        skillName: ins.skillName,
        projectId: ins.projectId,
        agent: ins.agent,
      });
      await refresh();
      const updated = await invoke<SkillInstallation[]>('list_skill_installations', { skillName: ins.skillName });
      setManageInstallations(updated);
    } catch (e) { setError(String(e)); }
    finally { setPending(false); }
  };

  const hubPathSet = !!config?.hubPath;

  return (
    <div className="flex flex-col h-full overflow-auto" style={{ background: 'rgb(var(--aegis-bg))' }}>
      <div className="px-6 py-4 border-b" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
        <div className="flex items-center gap-2 mb-1">
          <Blocks size={18} className="text-aegis-primary" />
          <h1 className="text-[16px] font-bold text-aegis-text">Skill Hub Manager</h1>
        </div>
        <p className="text-[12px] text-aegis-text-dim">
          JunQi-style skill hub: frontmatter-parsed skill folders with per-project symlink installs.
        </p>
      </div>

      {/* Hub path config */}
      <div className="px-6 py-4 border-b" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
        <div className="text-[11px] font-semibold text-aegis-text-muted uppercase tracking-wider mb-2">
          Hub path
        </div>
        <div className="flex items-center gap-2">
          <input
            value={hubInput}
            onChange={(e) => setHubInput(e.target.value)}
            placeholder="/path/to/skills"
            className="flex-1 px-3 py-2 rounded-md text-[12px] font-mono"
            style={{
              background: 'rgb(var(--aegis-input))',
              border: '1px solid rgb(var(--aegis-border))',
              color: 'rgb(var(--aegis-text))',
            }}
          />
          <button
            type="button"
            onClick={handleSetHub}
            disabled={pending || !hubInput.trim()}
            className="px-3 py-2 rounded-md text-[12px] font-semibold transition-opacity"
            style={{
              background: 'rgb(var(--aegis-primary))',
              color: 'rgb(var(--aegis-on-primary))',
              opacity: pending || !hubInput.trim() ? 0.5 : 1,
            }}
          >
            <FolderOpen size={13} className="inline-block mr-1" />
            Set
          </button>
          {hubPathSet && (
            <button
              type="button"
              onClick={handleClearHub}
              disabled={pending}
              className="px-3 py-2 rounded-md text-[12px] font-semibold transition-opacity"
              style={{
                background: 'transparent',
                color: 'rgb(var(--aegis-danger))',
                border: '1px solid rgb(var(--aegis-border))',
              }}
            >
              <Trash2 size={13} className="inline-block mr-1" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Install target */}
      {hubPathSet && (
        <div className="px-6 py-3 border-b" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
          <div className="text-[11px] font-semibold text-aegis-text-muted uppercase tracking-wider mb-2">
            Install target
          </div>
          <div className="flex items-center gap-2">
            <input
              value={targetProjectId}
              onChange={(e) => setTargetProjectId(e.target.value)}
              placeholder="/path/to/target/project"
              className="flex-1 px-3 py-1.5 rounded-md text-[12px] font-mono"
              style={{
                background: 'rgb(var(--aegis-input))',
                border: '1px solid rgb(var(--aegis-border))',
                color: 'rgb(var(--aegis-text))',
              }}
            />
            <select
              value={targetAgent}
              onChange={(e) => setTargetAgent(e.target.value as 'claude' | 'codex')}
              className="px-2 py-1.5 rounded-md text-[12px]"
              style={{
                background: 'rgb(var(--aegis-input))',
                border: '1px solid rgb(var(--aegis-border))',
                color: 'rgb(var(--aegis-text))',
              }}
            >
              <option value="claude">claude</option>
              <option value="codex">codex</option>
            </select>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="mx-6 mt-3 px-3 py-2 rounded-md text-[12px] flex items-start gap-2"
          style={{
            background: 'rgb(var(--aegis-danger) / 0.1)',
            border: '1px solid rgb(var(--aegis-danger) / 0.3)',
            color: 'rgb(var(--aegis-danger))',
          }}
        >
          <AlertTriangle size={14} className="mt-[1px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Skills list */}
      <div className="flex-1 px-6 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-aegis-text-dim text-[13px]">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : !hubPathSet ? (
          <div className="text-center py-12">
            <Blocks size={32} className="mx-auto mb-3 text-aegis-text-dim opacity-40" />
            <div className="text-[13px] text-aegis-text-dim">
              Set a hub path above to start scanning skills.
            </div>
          </div>
        ) : skills.length === 0 ? (
          <div className="text-center py-12 text-[13px] text-aegis-text-dim">
            No skills found in hub. Each subdirectory should contain a SKILL.md with frontmatter.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {skills.map((skill) => {
              const ins = installationBySkill.get(skill.name) ?? [];
              return (
                <div
                  key={skill.name}
                  className="rounded-lg p-3 flex items-start gap-3"
                  style={{
                    background: 'rgb(var(--aegis-card))',
                    border: '1px solid rgb(var(--aegis-border))',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[13px] font-semibold text-aegis-text">
                        {skill.displayName ?? skill.name}
                      </span>
                      {skill.hasError && (
                        <span className="text-[10px] text-aegis-warning flex items-center gap-1">
                          <AlertTriangle size={10} />
                          {skill.hasError}
                        </span>
                      )}
                    </div>
                    {skill.description && (
                      <div className="text-[11.5px] text-aegis-text-muted line-clamp-2 mb-1">
                        {skill.description}
                      </div>
                    )}
                    <div className="text-[10px] font-mono text-aegis-text-dim truncate">
                      {skill.path}
                    </div>
                    {ins.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {ins.map((i, idx) => (
                          <span
                            key={`${i.projectId}-${i.agent}-${idx}`}
                            className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-mono ${healthColor(i.health)}`}
                            style={{
                              background: 'rgb(var(--aegis-overlay) / 0.05)',
                              border: '1px solid rgb(var(--aegis-border))',
                            }}
                          >
                            {healthIcon(i.health)}
                            {i.agent} · {i.projectId.split('/').slice(-1)[0]}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleInstall(skill)}
                      disabled={pending || !targetProjectId.trim()}
                      className="px-2 py-1 rounded-md text-[10.5px] font-semibold flex items-center gap-1 transition-opacity"
                      style={{
                        background: 'rgb(var(--aegis-primary))',
                        color: 'rgb(var(--aegis-on-primary))',
                        opacity: pending || !targetProjectId.trim() ? 0.4 : 1,
                      }}
                    >
                      <Plus size={11} />
                      Install
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenManage(skill)}
                      disabled={pending}
                      className="px-2 py-1 rounded-md text-[10.5px] font-semibold flex items-center gap-1 transition-opacity"
                      style={{
                        background: 'rgb(var(--aegis-overlay) / 0.05)',
                        color: 'rgb(var(--aegis-text-secondary))',
                        border: '1px solid rgb(var(--aegis-border))',
                      }}
                    >
                      <Settings size={11} />
                      Manage
                    </button>
                    {ins.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleDelete(skill)}
                        disabled={pending}
                        className="px-2 py-1 rounded-md text-[10.5px] font-semibold flex items-center gap-1 transition-opacity"
                        style={{
                          background: 'transparent',
                          color: 'rgb(var(--aegis-danger))',
                          border: '1px solid rgb(var(--aegis-border))',
                        }}
                      >
                        <Link2 size={11} />
                        Unlink
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Installations summary */}
      {installations.length > 0 && (
        <div
          className="px-6 py-3 border-t text-[11px] text-aegis-text-dim flex items-center gap-2"
          style={{ borderColor: 'rgb(var(--aegis-border))' }}
        >
          <Link2 size={12} />
          {installations.length} installation{installations.length === 1 ? '' : 's'} tracked
        </div>
      )}

      {/* ── SkillManageDialog ──────────────────────────────────────────── */}
      {installConflict && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 px-4" onClick={() => setInstallConflict(null)}>
          <div role="dialog" aria-modal="true" aria-label="Skill install conflict" className="w-full max-w-[460px] overflow-hidden rounded-lg border border-aegis-border bg-aegis-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-aegis-border px-4 py-3">
              <AlertTriangle size={16} className="text-aegis-warning" />
              <span className="text-sm font-semibold text-aegis-text">Installation conflict</span>
            </div>
            <div className="space-y-2 px-4 py-4 text-xs text-aegis-text-dim">
              <p>A {installConflict.conflict.existingKind} already exists at the target path.</p>
              <p className="break-all rounded bg-aegis-surface px-2 py-1.5 font-mono text-[11px] text-aegis-text">{installConflict.conflict.linkPath}</p>
              {installConflict.conflict.existingTarget && <p className="break-all font-mono text-[11px]">Current target: {installConflict.conflict.existingTarget}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-aegis-border px-4 py-3">
              <button type="button" onClick={() => void resolveInstallConflict('cancel')} className="rounded border border-aegis-border px-3 py-1.5 text-xs text-aegis-text-dim hover:bg-aegis-hover">Cancel</button>
              <button type="button" onClick={() => void resolveInstallConflict('skip')} className="rounded border border-aegis-border px-3 py-1.5 text-xs text-aegis-text hover:bg-aegis-hover">Skip</button>
              <button type="button" onClick={() => void resolveInstallConflict('overwrite')} className="rounded bg-aegis-danger px-3 py-1.5 text-xs font-semibold text-white">Overwrite</button>
            </div>
          </div>
        </div>
      )}

      {manageSkill && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: 'rgb(0 0 0 / 0.5)' }}
          onClick={() => setManageSkill(null)}>
          <div className="w-[500px] max-h-[70vh] rounded-xl overflow-hidden flex flex-col"
            style={{ background: 'rgb(var(--aegis-card))', border: '1px solid rgb(var(--aegis-border))' }}
            onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-3 border-b flex items-center gap-3"
              style={{ borderColor: 'rgb(var(--aegis-border))' }}>
              <Settings size={15} className="text-aegis-primary" />
              <div className="flex-1">
                <div className="text-[13px] font-bold text-aegis-text">Manage: {manageSkill.displayName ?? manageSkill.name}</div>
                <div className="text-[10px] font-mono text-aegis-text-dim truncate">{manageSkill.path}</div>
              </div>
              <button type="button" onClick={() => setManageSkill(null)}
                className="p-1 rounded hover:bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-dim">
                <X size={14} />
              </button>
            </div>
            {/* Install to new project */}
            <div className="px-5 py-3 border-b" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
              <div className="text-[11px] font-semibold text-aegis-text-muted mb-2">Install to another project</div>
              <div className="flex items-center gap-2">
                <input value={manageProject} onChange={(e) => setManageProject(e.target.value)}
                  placeholder="/path/to/project"
                  className="flex-1 px-3 py-1.5 rounded-md text-[12px] font-mono"
                  style={{ background: 'rgb(var(--aegis-input))', border: '1px solid rgb(var(--aegis-border))', color: 'rgb(var(--aegis-text))' }} />
                <select value={manageAgent} onChange={(e) => setManageAgent(e.target.value as 'claude' | 'codex')}
                  className="px-2 py-1.5 rounded-md text-[12px]"
                  style={{ background: 'rgb(var(--aegis-input))', border: '1px solid rgb(var(--aegis-border))', color: 'rgb(var(--aegis-text))' }}>
                  <option value="claude">claude</option>
                  <option value="codex">codex</option>
                </select>
                <button type="button" onClick={handleManageInstall} disabled={pending || !manageProject.trim()}
                  className="px-3 py-1.5 rounded-md text-[11px] font-semibold transition-opacity flex items-center gap-1"
                  style={{ background: 'rgb(var(--aegis-primary))', color: 'rgb(var(--aegis-on-primary))', opacity: pending || !manageProject.trim() ? 0.4 : 1 }}>
                  <Plus size={12} /> Add
                </button>
              </div>
            </div>
            {/* Installations list */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {manageInstallations.length === 0 ? (
                <div className="text-center py-8 text-[12px] text-aegis-text-dim">
                  No installations found. Add one above.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {manageInstallations.map((ins, idx) => (
                    <div key={idx} className="flex items-center gap-3 rounded-lg p-2.5"
                      style={{ background: 'rgb(var(--aegis-overlay) / 0.03)', border: '1px solid rgb(var(--aegis-border))' }}>
                      <span className={healthColor(ins.health)}>{healthIcon(ins.health)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold text-aegis-text">{ins.agent}</div>
                        <div className="text-[10px] font-mono text-aegis-text-dim truncate">{ins.projectId}</div>
                      </div>
                      <button type="button" onClick={() => handleManageRemove(ins)} disabled={pending}
                        className="px-2 py-1 rounded-md text-[10px] font-semibold text-aegis-danger hover:bg-aegis-danger/10 transition-colors">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SkillHubManager;
