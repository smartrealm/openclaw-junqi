export type BusinessGuideTaskState = 'available' | 'blocked' | 'completed';

export interface BusinessGuideFacts {
  connected: boolean;
  hasModels: boolean;
  hasSession: boolean;
  hasAgent: boolean;
  hasReadyChannel: boolean;
}

export interface BusinessGuideTask {
  id: 'start-chat' | 'choose-model' | 'review-agents' | 'connect-channel' | 'open-workspace';
  route: string;
  state: BusinessGuideTaskState;
  titleKey: string;
  descriptionKey: string;
}

export function projectBusinessGuide(facts: BusinessGuideFacts): BusinessGuideTask[] {
  const connectedState = facts.connected ? 'available' : 'blocked' as const;
  return [
    { id: 'start-chat', route: '/chat', state: facts.hasSession ? 'completed' : connectedState, titleKey: 'businessGuide.tasks.startChat.title', descriptionKey: 'businessGuide.tasks.startChat.description' },
    { id: 'choose-model', route: '/config', state: facts.hasModels ? 'completed' : connectedState, titleKey: 'businessGuide.tasks.chooseModel.title', descriptionKey: 'businessGuide.tasks.chooseModel.description' },
    { id: 'review-agents', route: '/agents', state: facts.hasAgent ? 'completed' : connectedState, titleKey: 'businessGuide.tasks.reviewAgents.title', descriptionKey: 'businessGuide.tasks.reviewAgents.description' },
    { id: 'connect-channel', route: '/channels', state: facts.hasReadyChannel ? 'completed' : connectedState, titleKey: 'businessGuide.tasks.connectChannel.title', descriptionKey: 'businessGuide.tasks.connectChannel.description' },
    { id: 'open-workspace', route: '/welcome', state: 'available', titleKey: 'businessGuide.tasks.openWorkspace.title', descriptionKey: 'businessGuide.tasks.openWorkspace.description' },
  ];
}
