export const JARVIS_SESSION_CATEGORY_PREFIX = 'Jarvis: ';

export interface JarvisSessionCategoryGateway {
  createSessionGroup(label: string): Promise<unknown>;
  setSessionCategory(category: string | null, sessionKey: string): Promise<unknown>;
}

export function createJarvisSessionCategory(trigger: string): string | null {
  const normalized = trigger.trim();
  return normalized ? `${JARVIS_SESSION_CATEGORY_PREFIX}${normalized}` : null;
}

export function isJarvisSessionCategory(category: unknown): category is string {
  return typeof category === 'string'
    && category.startsWith(JARVIS_SESSION_CATEGORY_PREFIX)
    && category.length > JARVIS_SESSION_CATEGORY_PREFIX.length;
}

/** Creates the native catalog entry before assigning an OpenClaw session category. */
export async function assignJarvisSessionCategory(
  gateway: JarvisSessionCategoryGateway,
  sessionKey: string,
  trigger: string,
): Promise<string | null> {
  const category = createJarvisSessionCategory(trigger);
  if (!category) return null;
  await gateway.createSessionGroup(category);
  await gateway.setSessionCategory(category, sessionKey);
  return category;
}
