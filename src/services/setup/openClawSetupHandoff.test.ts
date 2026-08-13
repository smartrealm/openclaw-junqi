import assert from "node:assert/strict";
import test from "node:test";
import { performOpenClawSetupHandoff } from "./openClawSetupHandoff";

function createPorts(events: string[], overrides: Partial<Parameters<typeof performOpenClawSetupHandoff>[0]> = {}) {
  return {
    waitForLifecycleIdle: async () => ({
      generation: 0,
      restartAttemptGeneration: 0,
      observedRestart: false,
    }),
    isLifecycleReceiptCurrent: () => true,
    captureAttestedConnectionId: () => {
      events.push("attested");
      return "connection-1";
    },
    isAttestedConnectionCurrent: () => true,
    reconnectSelectedRuntime: async () => {
      events.push("reconnect");
      return { success: true, connectionId: "connection-2" };
    },
    restartSelectedRuntime: async () => {
      events.push("restart");
      return { success: true, connectionId: "connection-2" };
    },
    probeSelectedGateway: async () => {
      events.push("probe");
      return true;
    },
    readConfigApplication: async () => {
      events.push("config");
      return { configRevisionHash: "configured", appliedConfigHash: "configured" };
    },
    ...overrides,
  };
}

function guidedEvidence(events: string[], setupComplete = true) {
  return {
    kind: "guided" as const,
    detectSetup: async () => {
      events.push("detect");
      return { setupComplete };
    },
    verifyModel: async () => {
      events.push("verify");
      return { ok: true as const };
    },
  };
}

test("OpenClaw 配置完成后按统一顺序交接给 JunQi", async () => {
  const events: string[] = [];

  const result = await performOpenClawSetupHandoff(createPorts(events), guidedEvidence(events));

  assert.deepEqual(result, { ready: true });
  assert.deepEqual(events, ["attested", "config", "probe", "detect", "verify", "config"]);
});

test("既有 Gateway 生命周期未释放前不得读取连接或配置证据", async () => {
  const events: string[] = [];
  let releaseIdle!: (value: {
    generation: number;
    restartAttemptGeneration: number;
    observedRestart: boolean;
  }) => void;
  const idle = new Promise<{
    generation: number;
    restartAttemptGeneration: number;
    observedRestart: boolean;
  }>((resolve) => {
    releaseIdle = resolve;
  });
  const handoff = performOpenClawSetupHandoff(createPorts(events, {
    waitForLifecycleIdle: () => idle,
  }), { kind: "classic-wizard-terminal" });

  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  assert.deepEqual(events, []);

  releaseIdle({ generation: 0, restartAttemptGeneration: 0, observedRestart: false });
  assert.deepEqual(await handoff, { ready: true });
  assert.deepEqual(events, ["attested", "config", "probe", "config"]);
});

test("交接证据读取期间插入新的生命周期时重新取得代次并核验", async () => {
  const events: string[] = [];
  let generation = 0;
  let probeCalls = 0;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    waitForLifecycleIdle: async () => ({
      generation,
      restartAttemptGeneration: 0,
      observedRestart: false,
    }),
    isLifecycleReceiptCurrent: (receipt) => receipt.generation === generation,
    probeSelectedGateway: async () => {
      probeCalls += 1;
      events.push(`probe:${probeCalls}`);
      if (probeCalls === 1) generation += 1;
      return true;
    },
  }), { kind: "classic-wizard-terminal" });

  assert.deepEqual(result, { ready: true });
  assert.equal(probeCalls, 2);
  assert.deepEqual(events, [
    "attested",
    "config",
    "probe:1",
    "attested",
    "config",
    "probe:2",
    "config",
  ]);
});

test("receipt 失效期间完成的真实重启会阻止重复补偿", async () => {
  const events: string[] = [];
  let generation = 1;
  let restartAttemptGeneration = 4;
  let configReads = 0;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    waitForLifecycleIdle: async () => ({
      generation,
      restartAttemptGeneration,
      observedRestart: false,
    }),
    isLifecycleReceiptCurrent: (receipt) => receipt.generation === generation,
    readConfigApplication: async () => {
      configReads += 1;
      events.push(`config:${configReads}`);
      if (configReads === 1) {
        generation += 1;
        restartAttemptGeneration += 1;
      }
      return configReads < 3
        ? { configRevisionHash: "configured", appliedConfigHash: "old", reloadDisabled: true }
        : { configRevisionHash: "configured", appliedConfigHash: "configured", reloadDisabled: true };
    },
    restartSelectedRuntime: async () => {
      events.push("restart");
      return { success: true, connectionId: "connection-2" };
    },
    wait: async () => undefined,
  }), { kind: "classic-wizard-terminal" });

  assert.deepEqual(result, { ready: true });
  assert.equal(events.includes("restart"), false);
});

test("交接已等待过重启时只核验应用结果而不补发第二次重启", async () => {
  const events: string[] = [];
  let configReads = 0;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    waitForLifecycleIdle: async () => ({
      generation: 1,
      restartAttemptGeneration: 1,
      observedRestart: true,
    }),
    restartSelectedRuntime: async () => {
      events.push("restart");
      return { success: true, connectionId: "connection-2" };
    },
    readConfigApplication: async () => {
      configReads += 1;
      events.push("config");
      return configReads === 1
        ? { configRevisionHash: "configured", appliedConfigHash: "old", reloadDisabled: true }
        : { configRevisionHash: "configured", appliedConfigHash: "configured", reloadDisabled: true };
    },
  }), { kind: "classic-wizard-terminal" });

  assert.deepEqual(result, { ready: true });
  assert.equal(events.includes("restart"), false);
});

test("当前认证连接采用最终配置时无需制造额外重启", async () => {
  const events: string[] = [];
  let fencedConnectionId = "";

  const result = await performOpenClawSetupHandoff(createPorts(events, {
    readConfigApplication: async (connectionId) => {
      fencedConnectionId = connectionId;
      events.push("config");
      return { configRevisionHash: "configured", appliedConfigHash: "configured" };
    },
  }), guidedEvidence(events));

  assert.deepEqual(result, { ready: true });
  assert.equal(fencedConnectionId, "connection-1");
  assert.deepEqual(events, ["attested", "config", "probe", "detect", "verify", "config"]);
});

test("官方配置未完成时停止交接且不执行模型核验", async () => {
  const events: string[] = [];

  const result = await performOpenClawSetupHandoff(
    createPorts(events),
    guidedEvidence(events, false),
  );

  assert.deepEqual(result, { ready: false, reason: "setup-incomplete" });
  assert.deepEqual(events, ["attested", "config", "probe", "detect"]);
});

test("模型核验失败时保留官方诊断并停留在交接阶段", async () => {
  const events: string[] = [];

  const result = await performOpenClawSetupHandoff(createPorts(events), {
    kind: "guided",
    detectSetup: async () => {
      events.push("detect");
      return { setupComplete: true };
    },
    verifyModel: async () => {
      events.push("verify");
      return { ok: false as const, error: "provider rejected credential" };
    },
  });

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
    reconnectSelectedRuntime: async () => {
      events.push("reconnect");
      return { success: false, diagnostic: "connection unavailable" };
    },
  }), guidedEvidence(events));

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
  }), guidedEvidence(events));

  assert.deepEqual(result, { ready: false, reason: "connection-unavailable" });
  assert.deepEqual(events, ["attested", "config", "probe"]);
});

test("经典 Wizard 官方终态不依赖 Guided 专属 RPC", async () => {
  const events: string[] = [];

  const result = await performOpenClawSetupHandoff(
    createPorts(events),
    { kind: "classic-wizard-terminal" },
  );

  assert.deepEqual(result, { ready: true });
  assert.deepEqual(events, ["attested", "config", "probe", "config"]);
});

test("Gateway 不提供活动配置修订证据时停止交接", async () => {
  const events: string[] = [];
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    readConfigApplication: async () => {
      events.push("config");
      return {};
    },
  }), guidedEvidence(events));

  assert.deepEqual(result, {
    ready: false,
    reason: "configuration-application-unavailable",
  });
  assert.deepEqual(events, ["attested", "config"]);
});

test("配置读取在当前认证连接上失败时不触发重启", async () => {
  const events: string[] = [];
  let now = 0;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    readConfigApplication: async () => {
      events.push("config");
      throw new Error("config.get was rejected");
    },
    now: () => now,
    wait: async (delayMs) => { now += delayMs; },
  }), guidedEvidence(events));

  assert.deepEqual(result, {
    ready: false,
    reason: "configuration-application-timeout",
    diagnostic: "config.get was rejected",
  });
  assert.equal(events.includes("restart"), false);
});

test("配置读取瞬时失败后在同一认证连接上继续等待官方应用结果", async () => {
  const events: string[] = [];
  let attempts = 0;
  let now = 0;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    readConfigApplication: async () => {
      events.push("config");
      attempts += 1;
      if (attempts === 1) throw new Error("temporary config.get failure");
      return { configRevisionHash: "configured", appliedConfigHash: "configured" };
    },
    now: () => now,
    wait: async (delayMs) => { now += delayMs; },
  }), { kind: "classic-wizard-terminal" });

  assert.deepEqual(result, { ready: true });
  assert.equal(attempts, 3);
  assert.equal(events.includes("restart"), false);
});

test("配置读取因旧连接断开失败时重新读取所选运行时凭据", async () => {
  const events: string[] = [];
  let activeConnection = "connection-1";
  let firstRead = true;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    captureAttestedConnectionId: () => {
      events.push("attested");
      return activeConnection;
    },
    isAttestedConnectionCurrent: (connectionId) => connectionId === activeConnection,
    readConfigApplication: async () => {
      events.push("config");
      if (firstRead) {
        firstRead = false;
        activeConnection = "connection-closed";
        throw new Error("gateway connection closed");
      }
      return { configRevisionHash: "saved", appliedConfigHash: "saved" };
    },
    reconnectSelectedRuntime: async () => {
      events.push("reconnect");
      activeConnection = "connection-2";
      return { success: true, connectionId: activeConnection };
    },
  }), { kind: "classic-wizard-terminal" });

  assert.deepEqual(result, { ready: true });
  assert.equal(events.filter((event) => event === "reconnect").length, 1);
  assert.equal(events.at(-1), "config");
});

test("官方配置重启未在核验窗口内收敛时不主动制造第二次重启", async () => {
  const events: string[] = [];
  let now = 0;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    readConfigApplication: async () => {
      events.push("config");
      return { configRevisionHash: "saved", appliedConfigHash: "running" };
    },
    now: () => now,
    wait: async (delayMs) => { now += delayMs; },
  }), { kind: "classic-wizard-terminal" });

  assert.deepEqual(result, {
    ready: false,
    reason: "configuration-application-timeout",
  });
  assert.equal(events.includes("restart"), false);
  assert.equal(events.includes("probe"), false);
});

test("官方明确关闭配置重载时仅通过统一生命周期补发一次重启", async () => {
  const events: string[] = [];
  let activeConnection = "connection-1";
  let reads = 0;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    captureAttestedConnectionId: () => {
      events.push("attested");
      return activeConnection;
    },
    isAttestedConnectionCurrent: (connectionId) => connectionId === activeConnection,
    readConfigApplication: async () => {
      events.push("config");
      reads += 1;
      return reads === 1
        ? { configRevisionHash: "saved", appliedConfigHash: "running", reloadDisabled: true }
        : { configRevisionHash: "saved", appliedConfigHash: "saved", reloadDisabled: true };
    },
    restartSelectedRuntime: async () => {
      events.push("restart");
      activeConnection = "connection-2";
      return { success: true, connectionId: activeConnection };
    },
  }), { kind: "classic-wizard-terminal" });

  assert.deepEqual(result, { ready: true });
  assert.equal(events.filter((event) => event === "restart").length, 1);
  assert.equal(events.filter((event) => event === "config").length, 3);
});

test("完成门禁后配置修订漂移时重新收敛并重新核验官方完成证据", async () => {
  const events: string[] = [];
  let reads = 0;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    readConfigApplication: async () => {
      events.push("config");
      reads += 1;
      if (reads === 2) {
        return { configRevisionHash: "new", appliedConfigHash: "old" };
      }
      return { configRevisionHash: "new", appliedConfigHash: "new" };
    },
  }), guidedEvidence(events));

  assert.deepEqual(result, { ready: true });
  assert.equal(reads, 4);
  assert.equal(events.filter((event) => event === "detect").length, 2);
  assert.equal(events.filter((event) => event === "verify").length, 2);
});

test("配置在模型核验期间完整切换到新修订时重新核验证据", async () => {
  const events: string[] = [];
  let reads = 0;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    readConfigApplication: async () => {
      events.push("config");
      reads += 1;
      return reads === 1
        ? { configRevisionHash: "revision-a", appliedConfigHash: "revision-a" }
        : { configRevisionHash: "revision-b", appliedConfigHash: "revision-b" };
    },
  }), guidedEvidence(events));

  assert.deepEqual(result, { ready: true });
  assert.equal(reads, 4);
  assert.equal(events.filter((event) => event === "detect").length, 2);
  assert.equal(events.filter((event) => event === "verify").length, 2);
});

test("配置漂移跨两轮核验时整个事务最多补发一次重启", async () => {
  const events: string[] = [];
  let activeConnection = "connection-1";
  let reads = 0;
  let now = 0;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    captureAttestedConnectionId: () => activeConnection,
    isAttestedConnectionCurrent: (connectionId) => connectionId === activeConnection,
    readConfigApplication: async () => {
      reads += 1;
      if (reads === 2) {
        return { configRevisionHash: "saved", appliedConfigHash: "saved", reloadDisabled: true };
      }
      return { configRevisionHash: "saved", appliedConfigHash: "running", reloadDisabled: true };
    },
    restartSelectedRuntime: async () => {
      events.push("restart");
      activeConnection = `connection-${events.length + 1}`;
      return { success: true, connectionId: activeConnection };
    },
    now: () => now,
    wait: async () => { now += 60_000; },
  }), { kind: "classic-wizard-terminal" });

  assert.deepEqual(result, {
    ready: false,
    reason: "configuration-application-timeout",
  });
  assert.equal(events.filter((event) => event === "restart").length, 1);
});

test("两轮最终核验共享同一个绝对截止时间", async () => {
  const events: string[] = [];
  let reads = 0;
  let now = 0;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    readConfigApplication: async () => {
      reads += 1;
      if (reads === 2) {
        now = 400_000;
        return { configRevisionHash: "saved", appliedConfigHash: "running" };
      }
      return { configRevisionHash: "saved", appliedConfigHash: "saved" };
    },
    now: () => now,
  }), { kind: "classic-wizard-terminal" });

  assert.deepEqual(result, {
    ready: false,
    reason: "configuration-application-timeout",
  });
  assert.equal(reads, 2);
});

test("模型探测跨过事务截止时间时不得发布完成状态", async () => {
  const events: string[] = [];
  let now = 0;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    probeSelectedGateway: async () => {
      events.push("probe");
      now = 400_000;
      return true;
    },
    now: () => now,
  }), { kind: "classic-wizard-terminal" });

  assert.deepEqual(result, {
    ready: false,
    reason: "configuration-application-timeout",
  });
  assert.deepEqual(events, ["attested", "config", "probe"]);
});

test("配置交接重连只取得事务剩余的等待预算", async () => {
  const events: string[] = [];
  const timeouts: number[] = [];
  let now = 120_000;
  let captured = false;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    captureAttestedConnectionId: () => {
      if (!captured) {
        captured = true;
        now = 240_000;
      }
      return null;
    },
    reconnectSelectedRuntime: async (boundary) => {
      timeouts.push(boundary.deadline - now);
      return { success: false, diagnostic: "connection unavailable" };
    },
    now: () => now,
    wait: async (delayMs) => { now += delayMs; },
  }), { kind: "classic-wizard-terminal" });

  assert.deepEqual(result, {
    ready: false,
    reason: "connection-unavailable",
    diagnostic: "connection unavailable",
  });
  assert.deepEqual(timeouts, [240_000]);
});

test("交接截止时中止仍在执行的补偿重启", async () => {
  const events: string[] = [];
  let restartSignal: AbortSignal | undefined;
  let firstClockRead = true;
  const result = await performOpenClawSetupHandoff(createPorts(events, {
    readConfigApplication: async () => ({
      configRevisionHash: "saved",
      appliedConfigHash: "running",
      reloadDisabled: true,
    }),
    restartSelectedRuntime: (boundary) => {
      restartSignal = boundary.signal;
      return new Promise(() => {});
    },
    now: () => {
      if (firstClockRead) {
        firstClockRead = false;
        return 0;
      }
      return 359_999;
    },
  }), { kind: "classic-wizard-terminal" });

  assert.deepEqual(result, {
    ready: false,
    reason: "configuration-application-timeout",
  });
  assert.equal(restartSignal?.aborted, true);
});
