export type BusinessGuideCompletion =
  | { kind: 'target-click' }
  | { kind: 'selector-appears'; selector: string }
  | { kind: 'config-saved' }
  | { kind: 'session-created' }
  | { kind: 'user-message' }
  | { kind: 'assistant-response' };

export interface BusinessGuideStepDefinition {
  id:
    | 'configure-model-provider'
    | 'choose-model-provider'
    | 'save-model-provider'
    | 'new-session'
    | 'create-session'
    | 'send-first-message'
    | 'wait-first-response'
    | 'configure-channel'
    | 'manage-agents';
  route: string;
  selector: string;
  titleKey: string;
  descriptionKey: string;
  completion: BusinessGuideCompletion;
  stateKey?: string;
}

export const FIRST_RESPONSE_GUIDE_STEPS: readonly BusinessGuideStepDefinition[] = [
  {
    id: 'configure-model-provider',
    route: '/config',
    selector: '[data-tour="providers-add"]',
    titleKey: 'businessGuide.tasks.configureModelProvider.title',
    descriptionKey: 'businessGuide.tour.addProvider',
    completion: { kind: 'target-click' },
  },
  {
    id: 'choose-model-provider',
    route: '/config',
    selector: '[data-tour="provider-picker"]',
    titleKey: 'businessGuide.tasks.chooseModelProvider.title',
    descriptionKey: 'businessGuide.tour.chooseProvider',
    completion: { kind: 'selector-appears', selector: '[data-tour="provider-save"]' },
  },
  {
    id: 'save-model-provider',
    route: '/config',
    selector: '[data-tour="provider-save"]',
    titleKey: 'businessGuide.tasks.saveModelProvider.title',
    descriptionKey: 'businessGuide.tour.saveProvider',
    completion: { kind: 'config-saved' },
    stateKey: 'businessGuide.state.waitingSave',
  },
  {
    id: 'new-session',
    route: '/chat',
    selector: '[data-tour="chat-new-session"]',
    titleKey: 'businessGuide.tasks.newSession.title',
    descriptionKey: 'businessGuide.tour.newSession',
    completion: { kind: 'target-click' },
  },
  {
    id: 'create-session',
    route: '/chat',
    selector: '[data-tour="chat-create-session"]',
    titleKey: 'businessGuide.tasks.createSession.title',
    descriptionKey: 'businessGuide.tour.createSession',
    completion: { kind: 'session-created' },
    stateKey: 'businessGuide.state.waitingSession',
  },
  {
    id: 'send-first-message',
    route: '/chat',
    selector: '[data-tour="chat-composer"]',
    titleKey: 'businessGuide.tasks.sendFirstMessage.title',
    descriptionKey: 'businessGuide.tour.sendMessage',
    completion: { kind: 'user-message' },
  },
  {
    id: 'wait-first-response',
    route: '/chat',
    selector: '[data-tour="chat-composer"]',
    titleKey: 'businessGuide.tasks.waitFirstResponse.title',
    descriptionKey: 'businessGuide.tour.waitResponse',
    completion: { kind: 'assistant-response' },
    stateKey: 'businessGuide.state.waitingResponse',
  },
];

export const CHANNEL_GUIDE_STEPS: readonly BusinessGuideStepDefinition[] = [{
  id: 'configure-channel',
  route: '/channels',
  selector: '[data-tour="channels-add"]',
  titleKey: 'businessGuide.tasks.configureChannel.title',
  descriptionKey: 'businessGuide.tour.addChannel',
  completion: { kind: 'target-click' },
}];

export const AGENT_GUIDE_STEPS: readonly BusinessGuideStepDefinition[] = [{
  id: 'manage-agents',
  route: '/agents',
  selector: '[data-tour="agents-add"]',
  titleKey: 'businessGuide.tasks.manageAgents.title',
  descriptionKey: 'businessGuide.tour.addAgent',
  completion: { kind: 'target-click' },
}];
