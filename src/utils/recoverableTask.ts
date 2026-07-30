export type RecoverableTaskErrorHandler = (error: unknown) => void;

/** Runs a user-recoverable background operation without leaking its failure globally. */
export function startRecoverableTask(
  operation: () => Promise<unknown>,
  onError: RecoverableTaskErrorHandler,
): void {
  try {
    void operation().catch(onError);
  } catch (error) {
    onError(error);
  }
}
