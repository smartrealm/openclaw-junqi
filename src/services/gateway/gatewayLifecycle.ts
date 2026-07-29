import { gatewayManager } from './GatewayConnectionManager';
import { createGatewayLifecycleCoordinator } from './GatewayLifecycleCoordinator';

/** The only ordinary frontend Gateway restart/recovery entry point. */
export const gatewayLifecycle = createGatewayLifecycleCoordinator(gatewayManager);
