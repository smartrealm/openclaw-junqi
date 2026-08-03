import type { OpenclawStatus } from '@/api/tauri-commands';

/**
 * One set of criteria for "is this install usable".
 *
 * The repair trigger and the post-install success check used to disagree: a
 * repair was requested when any package/gateway-command check was bad, but
 * success only required `installed`. A partially applied reinstall could
 * therefore report success and defer the failure to gateway startup, by which
 * point the reinstall is no longer the obvious suspect.
 */
export type OpenclawInstallDefect =
  | 'package-invalid'
  | 'gateway-command-missing';

/** Every defect present in this status, in the order they should be reported. */
export function openclawInstallDefects(status: OpenclawStatus): OpenclawInstallDefect[] {
  const defects: OpenclawInstallDefect[] = [];
  if (!status.package_valid) defects.push('package-invalid');
  if (!status.gateway_command_ok) defects.push('gateway-command-missing');
  return defects;
}

/** An existing binary whose install is broken and should be repaired in place. */
export function requiresOpenclawRepair(status: OpenclawStatus): boolean {
  return status.binary_found && openclawInstallDefects(status).length > 0;
}

/** A freshly installed tree is only usable when no defect remains. */
export function isOpenclawInstallUsable(status: OpenclawStatus): boolean {
  return status.installed && openclawInstallDefects(status).length === 0;
}

const DEFECT_LABEL_KEYS: Record<OpenclawInstallDefect, string> = {
  'package-invalid': 'setup.openclawDefect.packageInvalid',
  'gateway-command-missing': 'setup.openclawDefect.gatewayCommandMissing',
};

/**
 * Points at the specific failed check rather than at "install failed", so a
 * partially applied reinstall is diagnosable from the setup log alone.
 */
export function describeOpenclawInstallFailure(
  status: OpenclawStatus,
  t: (key: string, options?: never) => string,
): string | null {
  if (isOpenclawInstallUsable(status)) return null;
  if (!status.installed) {
    return status.error || t('setup.openclawInstallFailed');
  }
  const detail = openclawInstallDefects(status)
    .map((defect) => t(DEFECT_LABEL_KEYS[defect]))
    .join('; ');
  const base = t('setup.openclawInstallIncomplete');
  return detail ? `${base}: ${detail}` : base;
}
