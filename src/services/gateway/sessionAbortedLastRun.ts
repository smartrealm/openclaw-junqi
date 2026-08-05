/** 仅投影 Gateway 显式给出的最近一次运行已中止真值。 */
export function parseGatewaySessionAbortedLastRun(value: unknown): true | null {
  return value === true ? true : null;
}
