export const JARVIS_SESSION_CATEGORY_PREFIX = 'Jarvis: ';

export function createJarvisSessionCategory(trigger: string): string | null {
  const normalized = trigger.trim();
  return normalized ? `${JARVIS_SESSION_CATEGORY_PREFIX}${normalized}` : null;
}

export function isJarvisSessionCategory(category: unknown): category is string {
  return typeof category === 'string'
    && category.startsWith(JARVIS_SESSION_CATEGORY_PREFIX)
    && category.length > JARVIS_SESSION_CATEGORY_PREFIX.length;
}
