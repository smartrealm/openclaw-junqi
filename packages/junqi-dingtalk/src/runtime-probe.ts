import { serializeRuntimeError } from "./errors.js";
import type { DwsRunner } from "./dws-runner.js";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringAt(value: RecordValue | null, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = string(value?.[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface DwsProfileProjection {
  readonly profile: string;
  readonly corpId: string;
  readonly corpName?: string;
  readonly userId?: string;
  readonly userName?: string;
  readonly status?: string;
  readonly authorizedDomains: readonly string[];
  readonly expiresAt?: string;
  readonly refreshExpiresAt?: string;
  readonly isCurrent: boolean;
}

export interface DwsUserProjection {
  readonly name?: string;
  readonly userId?: string;
  readonly organization?: string;
  readonly department?: string;
  readonly avatarUrl?: string;
}

function profileProjection(value: unknown): DwsProfileProjection | null {
  const item = record(value);
  const profile = stringAt(item, "profile");
  const corpId = stringAt(item, "corpId", "corp_id");
  if (!profile || !corpId) return null;
  const corpName = stringAt(item, "corpName", "corp_name");
  const userId = stringAt(item, "userId", "user_id");
  const userName = stringAt(item, "userName", "user_name");
  const status = stringAt(item, "status");
  const expiresAt = stringAt(item, "expiresAt");
  const refreshExpiresAt = stringAt(item, "refreshExpAt");
  return {
    profile,
    corpId,
    ...(corpName ? { corpName } : {}),
    ...(userId ? { userId } : {}),
    ...(userName ? { userName } : {}),
    ...(status ? { status } : {}),
    authorizedDomains: array(item?.authorizedDomains).flatMap((entry) => string(entry) ? [string(entry)!] : []),
    ...(expiresAt ? { expiresAt } : {}),
    ...(refreshExpiresAt ? { refreshExpiresAt } : {}),
    isCurrent: item?.isCurrent === true,
  };
}

export function projectDwsProfiles(value: unknown): readonly DwsProfileProjection[] {
  const payload = record(value);
  const currentProfile = stringAt(payload, "currentProfile");
  return array(payload?.profiles)
    .map(profileProjection)
    .filter((profile): profile is DwsProfileProjection => Boolean(profile))
    .map((profile) => ({ ...profile, isCurrent: profile.isCurrent || profile.profile === currentProfile }));
}

function findEmployee(value: unknown): RecordValue | null {
  const source = record(value);
  if (!source) return null;
  const result = array(source.result);
  const first = record(result[0]);
  return record(first?.orgEmployeeModel) ?? first ?? record(source.orgEmployeeModel) ?? record(source.result) ?? source;
}

export function projectDwsCurrentUser(value: unknown): DwsUserProjection | null {
  const employee = findEmployee(value);
  if (!employee) return null;
  const avatarUrl = stringAt(employee, "avatarUrl", "avatar_url", "avatar");
  const safeAvatarUrl = avatarUrl && /^https:\/\//i.test(avatarUrl) ? avatarUrl : undefined;
  const name = stringAt(employee, "orgUserName", "name", "userName", "nick");
  const userId = stringAt(employee, "userId", "userid", "staffId");
  const organization = stringAt(employee, "orgName", "corpName");
  const department = stringAt(employee, "deptName", "departmentName");
  const projection: DwsUserProjection = {
    ...(name ? { name } : {}),
    ...(userId ? { userId } : {}),
    ...(organization ? { organization } : {}),
    ...(department ? { department } : {}),
    ...(safeAvatarUrl ? { avatarUrl: safeAvatarUrl } : {}),
  };
  return Object.keys(projection).length > 0 ? projection : null;
}

export async function probeDwsRuntime(runner: DwsRunner): Promise<RecordValue> {
  try {
    await runner.resolveExecutable();
  } catch (error) {
    return {
      available: false,
      runtimeError: serializeRuntimeError(error),
      profiles: [],
      currentProfile: null,
      currentUser: null,
    };
  }
  const probe = async (command: readonly string[], profile?: string): Promise<unknown> => {
    try {
      return (await runner.run(command, profile ? { profile } : {})).data;
    } catch (error) {
      return { success: false, error: serializeRuntimeError(error) };
    }
  };
  const [version, authStatus, profileList] = await Promise.all([
    probe(["version"]),
    probe(["auth", "status"]),
    probe(["profile", "list"]),
  ]);
  const profiles = projectDwsProfiles(profileList);
  const currentProfile = profiles.find((profile) => profile.isCurrent) ?? null;
  const currentUserResult = currentProfile
    ? await probe(["contact", "user", "get-self"], currentProfile.profile)
    : null;
  return {
    available: true,
    version,
    authStatus,
    profiles,
    currentProfile: currentProfile?.profile ?? null,
    currentUser: currentUserResult ? projectDwsCurrentUser(currentUserResult) : null,
  };
}
