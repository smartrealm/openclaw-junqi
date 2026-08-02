/**
 * An exact local KWS result is the user's deliberate barge-in signal. Plain
 * VAD and browser dictation have no such proof and remain suppressed while
 * assistant audio is active to avoid accepting speaker feedback as input.
 */
export function shouldAcceptVoiceWakeDuringOutput(
  trigger: string | null,
  assistantOutputActive: boolean,
): boolean {
  return !assistantOutputActive || Boolean(trigger?.trim());
}
