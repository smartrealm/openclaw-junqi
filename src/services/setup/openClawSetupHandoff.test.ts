import assert from "node:assert/strict";
import test from "node:test";
import { performOpenClawSetupHandoff } from "./openClawSetupHandoff";

function createPorts(events: string[], overrides: Partial<Parameters<typeof performOpenClawSetupHandoff>[0]> = {}) {
  return {
    captureAttestedConnectionId: () => {
      events.push("attested");
      return "connection-1";
    },
    isAttestedConnectionCurrent: () => true,
    reconnect: async () => {
      events.push("reconnect");
      return { success: true };
    },
    probeSelectedGateway: async () => {
      events.push("probe");
      return true;
    },
    detectSetup: async () => {
      events.push("detect");
      return { setupComplete: true };
    },
    verifyModel: async () => {
      events.push("verify");
      return { ok: true as const };
    },
    ...overrides,
  };
}

test("OpenClaw 配置完成后按统一顺序交接给 JunQi", async () => {
  const events: string[] = [];

  const result = await performOpenClawSetupHandoff(createPorts(events));

  assert.deepEqual(result, { ready: true });
  assert.deepEqual(events, ["attested", "probe", "detect", "verify"]);
});

test("当前认证连接失效时先重连再继续交接", async () => {
  const events: string[] = [];

  const result = await performOpenClawSetupHandoff(createPorts(events, {
    captureAttestedConnectionId: () => {
      events.push("attested");
      return events.includes("reconnect") ? "connection-2" : null;
    },
  }));

  assert.deepEqual(result, { ready: true });
  assert.deepEqual(events, ["attested", "reconnect", "attested", "probe", "detect", "verify"]);
});

test("官方配置未完成时停止交接且不执行模型核验", async () => {
  const events: string[] = [];

  const result = await performOpenClawSetupHandoff(createPorts(events, {
    detectSetup: async () => {
      events.push("detect");
      return { setupComplete: false };
    },
  }));

  assert.deepEqual(result, { ready: false, reason: "setup-incomplete" });
  assert.deepEqual(events, ["attested", "probe", "detect"]);
});

test("模型核验失败时保留官方诊断并停留在交接阶段", async () => {
  const events: string[] = [];

  const result = await performOpenClawSetupHandoff(createPorts(events, {
    verifyModel: async () => {
      events.push("verify");
      return { ok: false as const, error: "provider rejected credential" };
    },
  }));

  assert.deepEqual(result, {
    ready: false,
    reason: "model-unverified",
    diagnostic: "provider rejected credential",
  });
});

test("连接交接失败时不继续读取配置", async () => {
  const events: string[] = [];

  const result = await performOpenClawSetupHandoff(createPorts(events, {
    captureAttestedConnectionId: () => {
      events.push("attested");
      return null;
    },
    reconnect: async () => {
      events.push("reconnect");
      return { success: false, diagnostic: "connection unavailable" };
    },
  }));

  assert.deepEqual(result, {
    ready: false,
    reason: "connection-unavailable",
    diagnostic: "connection unavailable",
  });
  assert.deepEqual(events, ["attested", "reconnect"]);
});

test("交接期间认证连接变化时停止提交完成状态", async () => {
  const events: string[] = [];
  let current = true;

  const result = await performOpenClawSetupHandoff(createPorts(events, {
    probeSelectedGateway: async () => {
      events.push("probe");
      current = false;
      return true;
    },
    isAttestedConnectionCurrent: () => current,
  }));

  assert.deepEqual(result, { ready: false, reason: "connection-unavailable" });
  assert.deepEqual(events, ["attested", "probe"]);
});
