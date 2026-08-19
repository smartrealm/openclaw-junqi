export function shouldHideDingTalkReadinessPanel(
  hideWhenReady: boolean,
  ready: boolean,
  operationError: string | null,
  operationNotice: string | null,
): boolean {
  return hideWhenReady && ready && !operationError && !operationNotice;
}
