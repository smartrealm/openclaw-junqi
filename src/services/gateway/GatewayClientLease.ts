import { gateway } from './index';
import { resolveConnectionTarget } from './GatewayActionExecutor';

/**
 * Owns a connection-only Gateway lease for lightweight auxiliary windows.
 * It deliberately has no start/restart API: process lifecycle belongs to the
 * main window. The generation guard also makes React StrictMode cleanup safe.
 */
export class GatewayClientLease {
  private generation = 0;

  async acquire(onHttpUrl: (url: string) => void): Promise<void> {
    const generation = ++this.generation;
    const status = gateway.getStatus();
    if (status.connected || status.connecting) return;

    const target = await resolveConnectionTarget();
    if (generation !== this.generation) return;

    onHttpUrl(target.httpUrl);
    localStorage.setItem('aegis-gateway-http', target.httpUrl);
    gateway.connect(target.wsUrl, target.token, target.deviceToken);
  }

  release(): void {
    this.generation += 1;
    gateway.disconnect();
  }
}
