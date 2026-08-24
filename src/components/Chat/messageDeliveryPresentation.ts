export function visibleDeliveryFailureDetail(error: string | undefined): string | null {
  const detail = error?.trim();
  return detail ? detail : null;
}
