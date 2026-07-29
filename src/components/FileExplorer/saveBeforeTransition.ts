export async function runAfterSaveBarrier<T>(
  save: () => Promise<void>,
  transition: () => T | Promise<T>,
): Promise<T> {
  await save();
  return transition();
}
