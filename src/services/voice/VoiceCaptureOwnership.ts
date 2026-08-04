declare const voiceCaptureLeaseBrand: unique symbol;

export interface VoiceCaptureLease {
  readonly ownerId: string;
  readonly [voiceCaptureLeaseBrand]: true;
}

/** 用对象身份隔离连续采集的每次启动，过期操作只能释放自己的原生所有者。 */
export class VoiceCaptureOwnership {
  private current: VoiceCaptureLease | null = null;

  begin(ownerId: string): VoiceCaptureLease {
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) throw new Error('语音采集所有者标识不能为空');
    const lease = { ownerId: normalizedOwnerId } as VoiceCaptureLease;
    this.current = lease;
    return lease;
  }

  owns(lease: VoiceCaptureLease | null | undefined): boolean {
    return Boolean(lease && this.current === lease);
  }

  getCurrent(): VoiceCaptureLease | null {
    return this.current;
  }

  takeCurrent(): VoiceCaptureLease | null {
    const lease = this.current;
    this.current = null;
    return lease;
  }

  release(lease: VoiceCaptureLease | null | undefined): boolean {
    if (!this.owns(lease)) return false;
    this.current = null;
    return true;
  }
}
