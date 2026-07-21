import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationError } from "./errors.js";
import { OpenClawRuntimeAdapter } from "./openclaw-adapter.js";

function adapterWithRuntime(
  runtime: Record<string, unknown>,
  options: { allowedAgentIds?: string[]; coordinatorAgentId?: string } = {},
): OpenClawRuntimeAdapter {
  return new OpenClawRuntimeAdapter(runtime as never, {
    emitAgentEvent: (() => ({ emitted: true })) as never,
    ...options,
  });
}

test("configured agents are the intersection of plugin and coordinator spawn policy", () => {
  const runtime = {
    version: "2026.7.1",
    config: {
      current: () => ({
        agents: {
          defaults: { subagents: { allowAgents: ["fallback"] } },
          list: [
            { id: "Coordinator", subagents: { allowAgents: ["coordinator", "worker"] } },
            { id: "worker" },
            { id: "blocked" },
          ],
        },
      }),
    },
  };
  const adapter = adapterWithRuntime(runtime, {
    coordinatorAgentId: "COORDINATOR",
    allowedAgentIds: ["coordinator", "worker", "blocked"],
  });

  assert.deepEqual(adapter.listConfiguredAgents().map((agent) => ({
    id: agent.id,
    allowed: agent.allowed,
    coordinator: agent.coordinator,
  })), [
    { id: "coordinator", allowed: true, coordinator: true },
    { id: "worker", allowed: true, coordinator: false },
    { id: "blocked", allowed: false, coordinator: false },
  ]);
});

test("an unset coordinator allowlist permits only the coordinator itself", () => {
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    config: {
      current: () => ({ agents: { list: [{ id: "coordinator" }, { id: "worker" }] } }),
    },
  }, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["*"],
  });

  assert.deepEqual(adapter.listConfiguredAgents().map((agent) => [agent.id, agent.allowed]), [
    ["coordinator", true],
    ["worker", false],
  ]);
});

test("managed flow creation returns a normalized observation and recovers a create race", () => {
  const existing = {
    flowId: "flow-existing",
    revision: 4,
    syncMode: "managed",
    controllerId: "junqi-collab/run-1",
    status: "running",
    stateJson: { runId: "run-1", domainRevision: 2 },
  };
  let flows = [existing];
  let createCalls = 0;
  const bound = {
    list: () => flows,
    tryCreateManaged: () => {
      createCalls += 1;
      return null;
    },
  };
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    tasks: { managedFlows: { bindSession: () => bound } },
  });

  assert.deepEqual(adapter.createManagedFlow({
    sessionKey: "agent:main:main",
    controllerId: "junqi-collab/run-1",
    goal: "test",
    state: { revision: 1 },
  }), {
    flowId: "flow-existing",
    revision: 4,
    status: "running",
    controllerId: "junqi-collab/run-1",
    state: { runId: "run-1", domainRevision: 2 },
    cancelRequestedAt: null,
  });
  assert.equal(createCalls, 0);
  assert.deepEqual(adapter.getManagedFlow({
    sessionKey: "agent:main:main",
    flowId: "flow-existing",
  }), {
    flowId: "flow-existing",
    revision: 4,
    status: "running",
    controllerId: "junqi-collab/run-1",
    state: { runId: "run-1", domainRevision: 2 },
    cancelRequestedAt: null,
  });

  flows = [];
  bound.tryCreateManaged = () => {
    createCalls += 1;
    flows = [{ ...existing, flowId: "flow-raced", revision: 1 }];
    return null;
  };
  assert.deepEqual(adapter.createManagedFlow({
    sessionKey: "agent:main:main",
    controllerId: "junqi-collab/run-1",
    goal: "test",
    state: { revision: 1 },
  }), {
    flowId: "flow-raced",
    revision: 1,
    status: "running",
    controllerId: "junqi-collab/run-1",
    state: { runId: "run-1", domainRevision: 2 },
    cancelRequestedAt: null,
  });
  assert.equal(createCalls, 1);
});

test("managed flow creation preserves the official initial revision zero", () => {
  const initial = {
    flowId: "flow-initial",
    revision: 0,
    syncMode: "managed",
    controllerId: "junqi-collab/run-initial",
    status: "running",
    stateJson: { runId: "run-initial", domainRevision: 1 },
  };
  let flows: typeof initial[] = [];
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    tasks: {
      managedFlows: {
        bindSession: () => ({
          list: () => flows,
          tryCreateManaged: () => {
            flows = [initial];
            return initial;
          },
        }),
      },
    },
  });

  assert.equal(adapter.createManagedFlow({
    sessionKey: "agent:main:main",
    controllerId: initial.controllerId,
    goal: "test",
    state: initial.stateJson,
  }).revision, 0);
});

test("collaboration change events use the external plugin-owned stream namespace", () => {
  let emitted: Record<string, unknown> | undefined;
  const adapter = new OpenClawRuntimeAdapter({ version: "2026.7.1" } as never, {
    emitAgentEvent: ((event: Record<string, unknown>) => {
      emitted = event;
      return { emitted: true, stream: event.stream };
    }) as never,
  });

  adapter.emitChanged({
    instanceId: "instance-1",
    runId: "run-1",
    runRevision: 2,
    lastSequence: 3,
  });

  assert.equal(emitted?.stream, "junqi-collab.changed");
  assert.equal((emitted?.data as Record<string, unknown>).collaborationInstanceId, "instance-1");
});

test("managed flow reuse exposes terminal, cancel-requested, and foreign-state observations", async (t) => {
  const cases = [
    {
      name: "cancelled",
      status: "cancelled",
      stateJson: { runId: "run-1", domainRevision: 2 },
      cancelRequestedAt: undefined,
    },
    {
      name: "failed",
      status: "failed",
      stateJson: { runId: "run-1", domainRevision: 2 },
      cancelRequestedAt: undefined,
    },
    {
      name: "cancel requested",
      status: "running",
      stateJson: { runId: "run-1", domainRevision: 2 },
      cancelRequestedAt: 1_784_253_600_000,
    },
    {
      name: "state owned by another run",
      status: "running",
      stateJson: { runId: "run-other", domainRevision: 9 },
      cancelRequestedAt: undefined,
    },
  ] as const;

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      let createCalls = 0;
      const existing = {
        flowId: `flow-${scenario.name}`,
        revision: 6,
        syncMode: "managed",
        controllerId: "junqi-collab/run-1",
        status: scenario.status,
        stateJson: scenario.stateJson,
        ...(scenario.cancelRequestedAt == null
          ? {}
          : { cancelRequestedAt: scenario.cancelRequestedAt }),
      };
      const adapter = adapterWithRuntime({
        version: "2026.7.1",
        tasks: {
          managedFlows: {
            bindSession: () => ({
              list: () => [existing],
              tryCreateManaged: () => {
                createCalls += 1;
                return null;
              },
            }),
          },
        },
      });

      assert.deepEqual(adapter.createManagedFlow({
        sessionKey: "agent:main:main",
        controllerId: "junqi-collab/run-1",
        goal: "test",
        state: { runId: "run-1", domainRevision: 1 },
      }), {
        flowId: `flow-${scenario.name}`,
        revision: 6,
        status: scenario.status,
        controllerId: "junqi-collab/run-1",
        state: scenario.stateJson,
        cancelRequestedAt: scenario.cancelRequestedAt ?? null,
      });
      assert.equal(createCalls, 0);
    });
  }
});

test("managed flow creation never reuses a different controller", () => {
  let createCalls = 0;
  const foreign = {
    flowId: "flow-foreign",
    revision: 5,
    syncMode: "managed",
    controllerId: "junqi-collab/run-other",
    status: "running",
    stateJson: { runId: "run-other", domainRevision: 8 },
  };
  const created = {
    flowId: "flow-run-1",
    revision: 1,
    syncMode: "managed",
    controllerId: "junqi-collab/run-1",
    status: "running",
    stateJson: { runId: "run-1", domainRevision: 1 },
  };
  const flows = [foreign];
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    tasks: {
      managedFlows: {
        bindSession: () => ({
          list: () => flows,
          tryCreateManaged: () => {
            createCalls += 1;
            flows.push(created);
            return created;
          },
        }),
      },
    },
  });

  assert.deepEqual(adapter.createManagedFlow({
    sessionKey: "agent:main:main",
    controllerId: "junqi-collab/run-1",
    goal: "test",
    state: { runId: "run-1", domainRevision: 1 },
  }), {
    flowId: "flow-run-1",
    revision: 1,
    status: "running",
    controllerId: "junqi-collab/run-1",
    state: { runId: "run-1", domainRevision: 1 },
    cancelRequestedAt: null,
  });
  assert.equal(createCalls, 1);
});

test("managed flow controller lookup and creation fail closed on duplicate controller ownership", () => {
  const duplicateFlows = ["flow-a", "flow-b"].map((flowId) => ({
    flowId,
    revision: 1,
    syncMode: "managed",
    controllerId: "junqi-collab/run-duplicate",
    status: "running",
    stateJson: { runId: "run-duplicate", domainRevision: 1 },
  }));
  let createCalls = 0;
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    tasks: {
      managedFlows: {
        bindSession: () => ({
          list: () => duplicateFlows,
          tryCreateManaged: () => {
            createCalls += 1;
            return null;
          },
        }),
      },
    },
  });

  assert.deepEqual(adapter.findManagedFlowByController({
    sessionKey: "agent:main:main",
    controllerId: "junqi-collab/run-duplicate",
  }), { kind: "AMBIGUOUS", matchCount: 2 });
  assert.throws(
    () => adapter.createManagedFlow({
      sessionKey: "agent:main:main",
      controllerId: "junqi-collab/run-duplicate",
      goal: "test",
      state: { runId: "run-duplicate", domainRevision: 1 },
    }),
    (error: unknown) => error instanceof CollaborationError
      && error.code === "INVALID_RESPONSE"
      && /Multiple managed Flows/.test(error.message),
  );
  assert.equal(createCalls, 0);
});

test("managed flow observation rejects a task-mirrored Flow with the same id", () => {
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    tasks: {
      managedFlows: {
        bindSession: () => ({
          list: () => [{
            flowId: "flow-task-mirrored",
            revision: 3,
            syncMode: "task_mirrored",
            status: "running",
          }],
        }),
      },
    },
  });

  assert.equal(adapter.getManagedFlow({
    sessionKey: "agent:main:main",
    flowId: "flow-task-mirrored",
  }), null);
});

test("managed flow cancellation resumes after requestCancel commits but cancel throws", async () => {
  const cancelRequestedAt = 1_784_253_600_000;
  let flow = {
    flowId: "flow-cancel-recovery",
    revision: 7,
    syncMode: "managed",
    controllerId: "junqi-collab/run-cancel-recovery",
    status: "running",
    stateJson: { runId: "run-cancel-recovery", domainRevision: 12 },
  } as {
    flowId: string;
    revision: number;
    syncMode: string;
    controllerId: string;
    status: string;
    stateJson: Record<string, unknown>;
    cancelRequestedAt?: number;
  };
  let requestCancelCalls = 0;
  let cancelCalls = 0;
  const bound = {
    list: () => [flow],
    requestCancel: ({ flowId, expectedRevision }: { flowId: string; expectedRevision: number }) => {
      requestCancelCalls += 1;
      assert.equal(flowId, flow.flowId);
      assert.equal(expectedRevision, 7);
      flow = { ...flow, revision: 8, cancelRequestedAt };
      return { applied: true, flow };
    },
    cancel: async ({ flowId }: { flowId: string }) => {
      cancelCalls += 1;
      assert.equal(flowId, flow.flowId);
      if (cancelCalls === 1) throw new Error("flow cancellation transport failed after request persisted");
      flow = { ...flow, revision: 9, status: "cancelled" };
      return { found: true, cancelled: true, flow };
    },
  };
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    config: { current: () => ({}) },
    tasks: { managedFlows: { bindSession: () => bound } },
  });
  const cancellation = {
    sessionKey: "agent:main:main",
    flowId: flow.flowId,
    expectedRevision: 7,
    state: { runId: "run-cancel-recovery", domainRevision: 12 },
    terminal: "cancelled" as const,
  };

  await assert.rejects(
    adapter.updateManagedFlow(cancellation),
    /flow cancellation transport failed after request persisted/,
  );
  assert.equal(requestCancelCalls, 1);
  assert.equal(cancelCalls, 1);
  assert.deepEqual(adapter.getManagedFlow({
    sessionKey: cancellation.sessionKey,
    flowId: cancellation.flowId,
  }), {
    flowId: "flow-cancel-recovery",
    revision: 8,
    status: "running",
    controllerId: "junqi-collab/run-cancel-recovery",
    state: { runId: "run-cancel-recovery", domainRevision: 12 },
    cancelRequestedAt,
  });

  assert.deepEqual(await adapter.updateManagedFlow(cancellation), { revision: 9 });
  assert.equal(requestCancelCalls, 1);
  assert.equal(cancelCalls, 2);
});

test("managed flow cancellation resumes when local storage already caught up to the request revision", async () => {
  const flow = {
    flowId: "flow-cancel-caught-up",
    revision: 8,
    syncMode: "managed",
    controllerId: "junqi-collab/run-cancel-caught-up",
    status: "running",
    stateJson: { runId: "run-cancel-caught-up", domainRevision: 12 },
    cancelRequestedAt: 1_784_253_600_000,
  };
  let cancelCalls = 0;
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    config: { current: () => ({}) },
    tasks: {
      managedFlows: {
        bindSession: () => ({
          list: () => [flow],
          requestCancel: () => {
            throw new Error("requestCancel must not repeat a persisted request");
          },
          cancel: async () => {
            cancelCalls += 1;
            return { found: true, cancelled: true, flow: { ...flow, revision: 9, status: "cancelled" } };
          },
        }),
      },
    },
  });

  assert.deepEqual(await adapter.updateManagedFlow({
    sessionKey: "agent:main:main",
    flowId: flow.flowId,
    expectedRevision: 8,
    state: { runId: "run-cancel-caught-up", domainRevision: 12 },
    terminal: "cancelled",
  }), { revision: 9 });
  assert.equal(cancelCalls, 1);
});

test("managed flow cancellation confirms only an exact cancelled Flow result", async (t) => {
  const cases = [
    {
      name: "flow not found",
      result: { found: false, cancelled: true, flowStatus: "cancelled" },
    },
    {
      name: "cancellation not confirmed",
      result: { found: true, cancelled: false, flowStatus: "cancelled" },
    },
    {
      name: "flow remains non-terminal",
      result: { found: true, cancelled: true, flowStatus: "running" },
    },
  ] as const;

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      let requestCancelCalls = 0;
      const pendingFlow = {
        flowId: `flow-${scenario.name}`,
        revision: 8,
        syncMode: "managed",
        controllerId: "junqi-collab/run-cancel-result",
        status: "running",
        stateJson: { runId: "run-cancel-result" },
        cancelRequestedAt: 1_784_253_600_000,
      };
      const adapter = adapterWithRuntime({
        version: "2026.7.1",
        config: { current: () => ({}) },
        tasks: {
          managedFlows: {
            bindSession: () => ({
              list: () => [pendingFlow],
              requestCancel: () => {
                requestCancelCalls += 1;
                return { applied: true, flow: pendingFlow };
              },
              cancel: async () => ({
                found: scenario.result.found,
                cancelled: scenario.result.cancelled,
                flow: { ...pendingFlow, revision: 9, status: scenario.result.flowStatus },
              }),
            }),
          },
        },
      });

      assert.equal(await adapter.updateManagedFlow({
        sessionKey: "agent:main:main",
        flowId: pendingFlow.flowId,
        expectedRevision: 7,
        state: { runId: "run-cancel-result" },
        terminal: "cancelled",
      }), null);
      assert.equal(requestCancelCalls, 0);
    });
  }
});

test("one worker dispatch calls subagent.run exactly once and only observes the resulting task", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const taskBindSessions: string[] = [];
  const runtime = {
    version: "2026.7.1",
    config: {
      current: () => ({
        agents: {
          list: [
            { id: "coordinator", subagents: { allowAgents: ["coordinator", "worker"] } },
            { id: "worker" },
          ],
        },
      }),
    },
    subagent: {
      run: async (params: Record<string, unknown>) => {
        calls.push(params);
        return { runId: "agent-run-1" };
      },
    },
    tasks: {
      runs: {
        bindSession: ({ sessionKey }: { sessionKey: string }) => {
          taskBindSessions.push(sessionKey);
          return {
            list: () => [
              {
                id: "task-cli",
                runtime: "cli",
                ownerKey: "agent:worker:main",
                childSessionKey: "agent:worker:subagent:collab-run-1-work-1-attempt-1",
                runId: "agent-run-1",
              },
              {
                id: "task-wrong-child",
                runtime: "subagent",
                ownerKey: "agent:worker:main",
                childSessionKey: "agent:worker:subagent:other-attempt",
                runId: "agent-run-1",
              },
              {
                id: "task-1",
                runtime: "subagent",
                ownerKey: "agent:worker:main",
                childSessionKey: "agent:worker:subagent:collab-run-1-work-1-attempt-1",
                runId: "agent-run-1",
              },
            ],
          };
        },
      },
      managedFlows: {
        bindSession: () => ({
          list: () => [],
          tryCreateManaged: () => {
            throw new Error("managed flow dispatch must not be used for worker execution");
          },
        }),
      },
    },
  };
  const adapter = adapterWithRuntime(runtime, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
  });

  const result = await adapter.runAgent({
    ownerAgentId: "worker",
    childSessionKey: "agent:worker:subagent:collab-run-1-work-1-attempt-1",
    message: "perform work",
    idempotencyKey: "effect-1",
  });

  assert.deepEqual(result, { runId: "agent-run-1", taskId: "task-1" });
  assert.deepEqual(calls, [{
    sessionKey: "agent:worker:subagent:collab-run-1-work-1-attempt-1",
    message: "perform work",
    idempotencyKey: "effect-1",
    deliver: false,
  }]);
  assert.deepEqual(taskBindSessions, ["agent:worker:main"]);
});

test("ACP worker dispatch uses the official Gateway tools.invoke sessions_spawn path", async () => {
  const gatewayCalls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let nativeCalls = 0;
  const runtime = {
    version: "2026.7.1",
    config: {
      current: () => ({
        agents: {
          list: [
            { id: "coordinator", subagents: { allowAgents: ["coordinator", "worker"] } },
            { id: "worker", runtime: { type: "acp", acp: { agent: "codex", backend: "acpx" } } },
          ],
        },
      }),
    },
    gateway: {
      request: async (method: string, params: Record<string, unknown>) => {
        gatewayCalls.push({ method, params });
        return {
          ok: true,
          toolName: "sessions_spawn",
          output: {
            status: "accepted",
            runId: "acp-run-1",
            childSessionKey: "agent:codex:acp:child-1",
          },
        };
      },
    },
    subagent: {
      run: async () => {
        nativeCalls += 1;
        return { runId: "must-not-start" };
      },
    },
    tasks: {
      runs: {
        bindSession: () => ({
          list: () => [{
            id: "task-acp-1",
            runtime: "acp",
            ownerKey: "agent:worker:main",
            childSessionKey: "agent:codex:acp:child-1",
            runId: "acp-run-1",
          }],
        }),
      },
    },
  };
  const adapter = adapterWithRuntime(runtime, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
  });

  assert.deepEqual(await adapter.runAgent({
    ownerAgentId: "worker",
    childSessionKey: "agent:worker:subagent:attempt-1",
    message: "perform ACP work",
    idempotencyKey: "effect-acp-1",
  }), {
    runId: "acp-run-1",
    childSessionKey: "agent:codex:acp:child-1",
    taskId: "task-acp-1",
  });
  assert.equal(nativeCalls, 0);
  assert.deepEqual(gatewayCalls, [{
    method: "tools.invoke",
    params: {
      name: "sessions_spawn",
      args: {
        task: "perform ACP work",
        runtime: "acp",
        agentId: "worker",
        mode: "run",
        label: "junqi-collab:c4afd37fea3c063c450cdcebbdde3ae0",
      },
      sessionKey: "agent:worker:main",
      agentId: "worker",
      idempotencyKey: "effect-acp-1",
    },
  }]);
});

test("ACP dispatch fails closed when Gateway does not accept sessions_spawn", async () => {
  let nativeCalls = 0;
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    config: {
      current: () => ({
        agents: {
          list: [
            { id: "coordinator", subagents: { allowAgents: ["coordinator", "worker"] } },
            { id: "worker", runtime: { type: "acp", acp: { agent: "codex" } } },
          ],
        },
      }),
    },
    gateway: {
      request: async () => ({
        ok: false,
        toolName: "sessions_spawn",
        error: { code: "forbidden", message: "ACP is disabled by policy" },
      }),
    },
    subagent: {
      run: async () => {
        nativeCalls += 1;
        return { runId: "must-not-start" };
      },
    },
  }, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
  });

  await assert.rejects(
    adapter.runAgent({
      ownerAgentId: "worker",
      childSessionKey: "agent:worker:subagent:attempt-1",
      message: "perform ACP work",
      idempotencyKey: "effect-acp-2",
    }),
    (error: unknown) => error instanceof CollaborationError && error.code === "CAPABILITY_CHANGED",
  );
  assert.equal(nativeCalls, 0);
});

test("ACP task recovery uses the deterministic dispatch label when the response lost its child key", async () => {
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    config: {
      current: () => ({
        agents: {
          list: [
            { id: "coordinator", subagents: { allowAgents: ["coordinator", "worker"] } },
            { id: "worker", runtime: { type: "acp", acp: { agent: "codex" } } },
          ],
        },
      }),
    },
    tasks: {
      runs: {
        bindSession: () => ({
          list: () => [{
            id: "task-acp-recovered",
            runtime: "acp",
            ownerKey: "agent:worker:main",
            childSessionKey: "agent:codex:acp:recovered-1",
            runId: "acp-run-recovered",
            label: "junqi-collab:b03223750d6182649cb795314fcd2629",
            status: "running",
          }],
        }),
      },
    },
  }, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
  });

  assert.deepEqual(await adapter.findAgentTask({
    ownerSessionKey: "agent:worker:main",
    childSessionKey: "agent:worker:subagent:attempt-1",
    expectedIdempotencyKey: "effect-acp-recovery",
  }), {
    kind: "FOUND",
    taskId: "task-acp-recovered",
    runId: "acp-run-recovered",
    childSessionKey: "agent:codex:acp:recovered-1",
    status: "running",
  });
});

test("explicit persisted ACP runtime survives a later Agent configuration change", async () => {
  let cancelledTaskId: string | null = null;
  const task = {
    id: "task-acp-frozen-runtime",
    runtime: "acp",
    ownerKey: "agent:worker:main",
    childSessionKey: "agent:codex:acp:frozen-1",
    runId: "acp-run-frozen",
    label: "junqi-collab:4fb7d2d6fbb2f77a7d916a7b3d7bfb3d",
    status: "running" as const,
  };
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    config: {
      current: () => ({
        agents: {
          list: [
            { id: "coordinator", subagents: { allowAgents: ["coordinator", "worker"] } },
            // The current config says native; the persisted Attempt says ACP.
            { id: "worker" },
          ],
        },
      }),
    },
    tasks: {
      runs: {
        bindSession: () => ({
          list: () => [task],
          get: (taskId: string) => taskId === task.id ? task : undefined,
          cancel: async ({ taskId }: { taskId: string }) => {
            cancelledTaskId = taskId;
            return { found: true, cancelled: true };
          },
        }),
      },
    },
  }, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
  });

  assert.deepEqual(await adapter.findAgentTask({
    ownerSessionKey: "agent:worker:main",
    childSessionKey: task.childSessionKey,
    expectedRunId: task.runId,
    taskRuntime: "acp",
  }), {
    kind: "FOUND",
    taskId: task.id,
    runId: task.runId,
    childSessionKey: task.childSessionKey,
    status: "running",
  });
  assert.deepEqual(await adapter.cancelRun({
    ownerSessionKey: "agent:worker:main",
    childSessionKey: task.childSessionKey,
    runId: task.runId,
    taskId: task.id,
    taskRuntime: "acp",
  }), { found: true, cancelled: true });
  assert.equal(cancelledTaskId, task.id);
});

test("ACP wait uses the official agent.wait Gateway RPC after task identity is observed", async () => {
  const calls: string[] = [];
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    config: {
      current: () => ({
        agents: {
          list: [
            { id: "coordinator", subagents: { allowAgents: ["coordinator", "worker"] } },
            { id: "worker", runtime: { type: "acp", acp: { agent: "codex" } } },
          ],
        },
      }),
    },
    gateway: {
      request: async (method: string) => {
        calls.push(method);
        return { runId: "acp-run-wait", status: "ok" };
      },
    },
    tasks: {
      runs: {
        bindSession: () => ({
          list: () => [{
            id: "task-acp-wait",
            runtime: "acp",
            ownerKey: "agent:worker:main",
            childSessionKey: "agent:codex:acp:wait-1",
            runId: "acp-run-wait",
            label: "junqi-collab:17dd2f349f916fcce227e8d68e1805f6",
            status: "running",
          }],
        }),
      },
    },
  }, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
  });
  await adapter.findAgentTask({
    ownerSessionKey: "agent:worker:main",
    childSessionKey: "agent:codex:acp:wait-1",
    expectedRunId: "acp-run-wait",
  });
  assert.deepEqual(await adapter.waitForRun("acp-run-wait", 500), { status: "ok" });
  assert.deepEqual(calls, ["agent.wait"]);
});

test("worker dispatch rejects a child session owned by another agent", async () => {
  const adapter = adapterWithRuntime({ version: "2026.7.1" });
  await assert.rejects(
    adapter.runAgent({
      ownerAgentId: "worker-a",
      childSessionKey: "agent:worker-b:subagent:attempt-1",
      message: "perform work",
      idempotencyKey: "effect-1",
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST",
  );
});

test("worker dispatch rechecks effective authorization before calling subagent.run", async () => {
  let coordinatorAllowlist = ["coordinator", "worker"];
  let runCalls = 0;
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    config: {
      current: () => ({
        agents: {
          list: [
            { id: "coordinator", subagents: { allowAgents: coordinatorAllowlist } },
            { id: "worker" },
          ],
        },
      }),
    },
    subagent: {
      run: async () => {
        runCalls += 1;
        return { runId: "must-not-start" };
      },
    },
  }, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
  });
  coordinatorAllowlist = ["coordinator"];

  await assert.rejects(
    adapter.runAgent({
      ownerAgentId: "worker",
      childSessionKey: "agent:worker:subagent:attempt-1",
      message: "perform work",
      idempotencyKey: "effect-1",
    }),
    (error: unknown) => error instanceof CollaborationError && error.code === "CAPABILITY_CHANGED",
  );
  assert.equal(runCalls, 0);
});

test("persistent task lookup requires one exact owner and child-session match", async () => {
  let tasks = [
    {
      id: "task-1",
      runtime: "subagent",
      ownerKey: "agent:worker:main",
      childSessionKey: "agent:worker:subagent:attempt-1",
      runId: "run-1",
      status: "running",
    },
    {
      id: "other-runtime",
      runtime: "cli",
      ownerKey: "agent:worker:main",
      childSessionKey: "agent:worker:subagent:attempt-1",
      runId: "cli-1",
      status: "running",
    },
  ];
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    tasks: { runs: { bindSession: () => ({ list: () => tasks }) } },
  });

  assert.deepEqual(await adapter.findAgentTask({
    ownerSessionKey: "agent:worker:main",
    childSessionKey: "agent:worker:subagent:attempt-1",
  }), {
    kind: "FOUND",
    taskId: "task-1",
    runId: "run-1",
    status: "running",
  });

  tasks = [...tasks, { ...tasks[0]!, id: "task-2", runId: "run-2" }];
  assert.deepEqual(await adapter.findAgentTask({
    ownerSessionKey: "agent:worker:main",
    childSessionKey: "agent:worker:subagent:attempt-1",
  }), {
    kind: "AMBIGUOUS",
    matchCount: 2,
    reason: "Multiple OpenClaw Tasks use the same child session key",
  });
});

test("persistent task lookup prefers an exact Task id even when the child session is duplicated", async () => {
  const tasks = [
    {
      id: "task-exact",
      runtime: "subagent",
      ownerKey: "agent:worker:main",
      childSessionKey: "agent:worker:subagent:attempt-1",
      runId: "run-exact",
      status: "succeeded",
      terminalOutcome: "blocked",
      terminalSummary: "required output was missing",
    },
    {
      id: "task-duplicate",
      runtime: "subagent",
      ownerKey: "agent:worker:main",
      childSessionKey: "agent:worker:subagent:attempt-1",
      runId: "run-duplicate",
      status: "running",
    },
  ];
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    tasks: {
      runs: {
        bindSession: () => ({
          list: () => tasks,
          get: (taskId: string) => tasks.find((task) => task.id === taskId),
        }),
      },
    },
  });

  assert.deepEqual(await adapter.findAgentTask({
    ownerSessionKey: "agent:worker:main",
    childSessionKey: "agent:worker:subagent:attempt-1",
    expectedTaskId: "task-exact",
    expectedRunId: "run-exact",
  }), {
    kind: "FOUND",
    taskId: "task-exact",
    runId: "run-exact",
    status: "succeeded",
    terminalOutcome: "blocked",
    terminalSummary: "required output was missing",
  });

  assert.deepEqual(await adapter.findAgentTask({
    ownerSessionKey: "agent:worker:main",
    childSessionKey: "agent:worker:subagent:attempt-1",
    expectedTaskId: "task-exact",
    expectedRunId: "another-run",
  }), {
    kind: "MISMATCH",
    reason: "The expected OpenClaw Task no longer matches its recorded owner, child session, or run",
  });
});

test("task cancellation requires the exact subagent owner, child session, and run identity", async () => {
  const tasks = [
    {
      id: "task-wrong-run",
      runtime: "subagent",
      ownerKey: "agent:worker:main",
      childSessionKey: "agent:worker:subagent:attempt-1",
      runId: "run-other",
      status: "running",
    },
    {
      id: "task-cli",
      runtime: "cli",
      ownerKey: "agent:worker:main",
      childSessionKey: "agent:worker:subagent:attempt-1",
      runId: "run-1",
      status: "running",
    },
    {
      id: "task-exact",
      runtime: "subagent",
      ownerKey: "agent:worker:main",
      childSessionKey: "agent:worker:subagent:attempt-1",
      runId: "run-1",
      status: "running",
    },
  ];
  const cancelled: string[] = [];
  const adapter = adapterWithRuntime({
    version: "2026.7.1",
    config: { current: () => ({}) },
    tasks: {
      runs: {
        bindSession: () => ({
          list: () => tasks,
          get: (taskId: string) => tasks.find((task) => task.id === taskId),
          cancel: async ({ taskId }: { taskId: string }) => {
            cancelled.push(taskId);
            return { found: true, cancelled: true };
          },
        }),
      },
    },
  });
  const identity = {
    ownerSessionKey: "agent:worker:main",
    childSessionKey: "agent:worker:subagent:attempt-1",
    runId: "run-1",
  };

  assert.deepEqual(await adapter.cancelRun({ ...identity, taskId: "task-wrong-run" }), {
    found: false,
    cancelled: false,
    reason: "task identity mismatch",
  });
  assert.deepEqual(await adapter.cancelRun({ ...identity, taskId: "task-cli" }), {
    found: false,
    cancelled: false,
    reason: "task identity mismatch",
  });
  assert.deepEqual(cancelled, []);

  assert.deepEqual(await adapter.cancelRun(identity), { found: true, cancelled: true });
  assert.deepEqual(cancelled, ["task-exact"]);
});
