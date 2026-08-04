/**
 * 精确的本地关键词识别是用户明确的打断信号；纯 VAD 没有该证明，在助手播放时
 * 必须抑制，避免把扬声器回声误作输入。
 */
export function shouldAcceptVoiceWakeDuringOutput(
  trigger: string | null,
  assistantOutputActive: boolean,
): boolean {
  return !assistantOutputActive || Boolean(trigger?.trim());
}
