export interface BusinessGuideActivationFacts {
  setupComplete: boolean;
  connected: boolean;
  identityVerified: boolean;
}

/** 只有所选运行时的本地完成标记、连接和身份事实同时成立时才展示业务引导。 */
export function isBusinessGuideActive(facts: BusinessGuideActivationFacts): boolean {
  return facts.setupComplete
    && facts.connected
    && facts.identityVerified;
}
