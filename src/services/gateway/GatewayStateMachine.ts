// Gateway 状态机只负责纯状态转换，不执行副作用。
// 输入当前状态与事件，输出下一状态和待执行动作。

import { GatewayState, GatewayEvent, type GatewayStateSnapshot } from './types';

/** 状态转换后由执行器处理的动作。 */
export type GatewayAction =
  | 'CONNECT'    // 建立 WebSocket 连接
  | 'START'      // 启动 Gateway 进程
  | 'START_DOCKER'
  | 'SHOW_ERROR'
  | 'NONE';

export interface TransitionResult {
  state: GatewayState;
  actions: GatewayAction[];
}

interface TransitionRule {
  from: GatewayState;
  event: string;
  to: GatewayState;
  actions: GatewayAction[];
}

/**
 * 声明式状态转换表。
 * 静态状态与事件在此登记，依赖事件载荷的转换由 transition 处理。
 */
const RULES: TransitionRule[] = [
  // 探测阶段。
  { from: GatewayState.DETECTING, event: 'STATUS_RECEIVED', to: GatewayState.CONNECTING,  actions: ['CONNECT'] },
  { from: GatewayState.DETECTING, event: 'WS_OPEN',         to: GatewayState.CONNECTED,   actions: [] },
  // 进程未运行与错误状态由 transition 根据事件载荷处理。

  // 启动阶段。
  { from: GatewayState.STARTING,  event: 'START_SUCCESS',   to: GatewayState.CONNECTING,  actions: ['CONNECT'] },
  { from: GatewayState.STARTING,  event: 'WS_OPEN',         to: GatewayState.CONNECTED,   actions: [] },

  // 连接阶段。
  { from: GatewayState.CONNECTING, event: 'WS_OPEN',         to: GatewayState.CONNECTED,   actions: [] },
  { from: GatewayState.CONNECTING, event: 'WS_CLOSE',        to: GatewayState.DETECTING,   actions: [] },

  // 已连接阶段。
  { from: GatewayState.CONNECTED,  event: 'WS_CLOSE',        to: GatewayState.DETECTING,   actions: [] },

  // 错误阶段。
  { from: GatewayState.ERROR,      event: 'RETRY',           to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.ERROR,      event: 'RESET',           to: GatewayState.DETECTING,   actions: [] },

  // 全局重置和重试统一回到探测阶段。
  { from: GatewayState.DETECTING,   event: 'RESET',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.STARTING,    event: 'RESET',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.CONNECTING,  event: 'RESET',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.CONNECTED,   event: 'RESET',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.DETECTING,   event: 'RETRY',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.STARTING,    event: 'RETRY',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.CONNECTING,  event: 'RETRY',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.CONNECTED,   event: 'RETRY',          to: GatewayState.DETECTING,   actions: [] },
];

export class GatewayStateMachine {
  private state: GatewayState = GatewayState.DETECTING;

  get current(): GatewayState {
    return this.state;
  }

  /** 处理事件；没有显式规则时保持当前状态。 */
  transition(event: GatewayEvent): TransitionResult {
    if (event.type === 'INITIALIZE' || event.type === 'RECOVERY_REQUESTED') {
      return this.apply(this.state, event.type, GatewayState.DETECTING, []);
    }
    if (event.type === 'START_REQUESTED') {
      return this.apply(this.state, event.type, GatewayState.STARTING, ['START']);
    }
    if (event.type === 'DOCKER_START_REQUESTED') {
      return this.apply(this.state, event.type, GatewayState.STARTING, ['START_DOCKER']);
    }
    if (event.type === 'START_FAILED') {
      return this.apply(this.state, event.type, GatewayState.ERROR, ['SHOW_ERROR']);
    }
    if (event.type === 'CONNECT_FAILED') {
      return this.apply(this.state, event.type, GatewayState.ERROR, ['SHOW_ERROR']);
    }

    // 进程存活、HTTP 端点就绪与 WebSocket 已连接是三个独立事实。
    // 状态观测不能启动进程；首次设置、冷启动恢复与手动恢复分别拥有启动意图，
    // 避免慢启动被误解为可以重复创建 Gateway 进程。
    if (event.type === 'STATUS_RECEIVED') {
      const { processAlive, endpointReady } = event;
      if (event.retrying) {
        return this.apply(this.state, 'STATUS_RECEIVED', GatewayState.DETECTING, []);
      }
      if (event.error) {
        return this.apply(this.state, 'STATUS_RECEIVED', GatewayState.ERROR, ['SHOW_ERROR']);
      }
      if (!processAlive) {
        return this.apply(this.state, 'STATUS_RECEIVED', GatewayState.DETECTING, []);
      }
      if (!endpointReady) {
        return this.apply(this.state, 'STATUS_RECEIVED', GatewayState.STARTING, []);
      }
      if (this.state === GatewayState.CONNECTED || this.state === GatewayState.CONNECTING) {
        return { state: this.state, actions: ['NONE'] };
      }
      if (endpointReady) {
        return this.apply(this.state, 'STATUS_RECEIVED', GatewayState.CONNECTING, ['CONNECT']);
      }
    }

    // 查找不依赖事件载荷的静态规则。
    const rule = RULES.find(r => r.from === this.state && r.event === event.type);
    if (!rule) return { state: this.state, actions: ['NONE'] };
    return this.apply(rule.from, rule.event, rule.to, rule.actions);
  }

  private apply(_from: GatewayState, _event: string, to: GatewayState, actions: GatewayAction[]): TransitionResult {
    this.state = to;
    return { state: to, actions };
  }

  /** 构造面向界面的状态快照。 */
  snapshot(
    error: string | null,
    retrying: boolean,
    selectedGatewayReady = false,
  ): GatewayStateSnapshot {
    return {
      state: this.state,
      connecting: this.state === GatewayState.CONNECTING || this.state === GatewayState.STARTING,
      connected: this.state === GatewayState.CONNECTED,
      error,
      retrying,
      selectedGatewayReady,
    };
  }
}
