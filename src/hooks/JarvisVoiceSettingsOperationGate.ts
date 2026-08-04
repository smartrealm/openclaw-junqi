export interface JarvisVoiceSettingsRefreshToken {
  requestRevision: number;
  dataRevision: number;
}

/** 阻止旧刷新覆盖事件推送或后发请求确认的新配置。 */
export class JarvisVoiceSettingsOperationGate {
  private requestRevision = 0;
  private dataRevision = 0;

  beginRefresh(): JarvisVoiceSettingsRefreshToken {
    this.requestRevision += 1;
    return {
      requestRevision: this.requestRevision,
      dataRevision: this.dataRevision,
    };
  }

  invalidateData(): void {
    this.dataRevision += 1;
  }

  isLatest(token: JarvisVoiceSettingsRefreshToken): boolean {
    return token.requestRevision === this.requestRevision;
  }

  canCommit(token: JarvisVoiceSettingsRefreshToken): boolean {
    return this.isLatest(token) && token.dataRevision === this.dataRevision;
  }
}
