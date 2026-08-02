import {
  clearSkillHub as clearSkillHubCommand,
  deleteSkillHubSkill as deleteSkillHubSkillCommand,
  getSkillHubConfig,
  installSkillHubSkill as installSkillHubSkillCommand,
  listSkillHubInstallations,
  listSkillHubSkills,
  setSkillHubPath as setSkillHubPathCommand,
  uninstallSkillHubSkill as uninstallSkillHubSkillCommand,
  type SkillHubInstallStrategy,
} from '@/api/tauri-commands';

export type {
  SkillHubConfig,
  SkillHubConflict,
  SkillHubDeleteResult,
  SkillHubInstallation,
  SkillHubInstallResult,
  SkillHubInstallStrategy,
  SkillHubSkill,
} from '@/api/tauri-commands';

export async function loadSkillHubState() {
  const [config, skills, installations] = await Promise.all([
    getSkillHubConfig(),
    listSkillHubSkills(),
    listSkillHubInstallations(),
  ]);
  return { config, skills, installations };
}

export function setSkillHubPath(path: string) {
  return setSkillHubPathCommand(path);
}

export function clearSkillHub() {
  return clearSkillHubCommand();
}

export function listSkillHubInstallationsFor(skillName: string) {
  return listSkillHubInstallations(skillName);
}

export function installSkillHubSkill(input: {
  skillName: string;
  skillPath: string;
  projectId: string;
  agent: 'claude' | 'codex';
  strategy: SkillHubInstallStrategy;
}) {
  return installSkillHubSkillCommand(input);
}

export function uninstallSkillHubSkill(input: {
  skillName: string;
  projectId: string;
  agent: string;
}) {
  return uninstallSkillHubSkillCommand(input);
}

export function deleteSkillHubSkill(skillName: string, skillPath: string) {
  return deleteSkillHubSkillCommand(skillName, skillPath);
}
