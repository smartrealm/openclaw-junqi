export interface BusinessGuideActivationFacts {
  setupComplete: boolean;
  connected: boolean;
  identityVerified: boolean;
  configurationVerified: boolean;
  modelVerified: boolean;
}

/** The guide is visible only while all selected-runtime facts are current. */
export function isBusinessGuideActive(facts: BusinessGuideActivationFacts): boolean {
  return facts.setupComplete
    && facts.connected
    && facts.identityVerified
    && facts.configurationVerified
    && facts.modelVerified;
}
