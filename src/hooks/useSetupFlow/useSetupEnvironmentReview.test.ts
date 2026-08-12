import assert from "node:assert/strict";
import test from "node:test";
import type { DockerStatus } from "@/api/tauri-commands";
import { settleInitialEnvironmentDetection } from "./useSetupEnvironmentReview";

test("首次环境检测等待 OpenClaw 与 Docker 都收敛后才返回结果", async () => {
  let resolveDocker: ((status: DockerStatus) => void) | undefined;
  const docker = new Promise<DockerStatus>((resolve) => {
    resolveDocker = resolve;
  });
  const status: DockerStatus = {
    available: true,
    version: "test",
    daemon_running: true,
    unsupported_reason: null,
    image_available: false,
  };
  let settled = false;

  const pending = settleInitialEnvironmentDetection(
    async () => "gateway-stopped",
    async () => docker,
  ).then((result) => {
    settled = true;
    return result;
  });

  await Promise.resolve();
  assert.equal(settled, false);

  resolveDocker?.(status);
  assert.deepEqual(await pending, {
    next: "gateway-stopped",
    docker: status,
  });
});
