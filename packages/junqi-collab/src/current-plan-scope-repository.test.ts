import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationDatabase } from "./database.js";
import { CurrentPlanScopeRepository, type CurrentPlanSqlRow } from "./current-plan-scope-repository.js";
import { CollaborationError } from "./errors.js";

const RUN_ID = "run-current-plan-scope";
const OLD_PLAN_ID = "plan-old";
const CURRENT_PLAN_ID = "plan-current";

function createFixture(): {
  database: CollaborationDatabase;
  repository: CurrentPlanScopeRepository;
  oldResearch: CurrentPlanSqlRow;
  currentResearch: CurrentPlanSqlRow;
  currentReview: CurrentPlanSqlRow;
} {
  const database = new CollaborationDatabase(":memory:");
  database.createRun({
    id: RUN_ID,
    origin: {
      runtimeId: "runtime-current-plan-scope",
      agentId: "main",
      sessionKey: "agent:main:current-plan-scope",
      sessionId: "session-current-plan-scope",
      nativeMessageId: "message-current-plan-scope",
    },
    goal: "Keep plan revisions isolated",
    capabilitySnapshot: {},
  });
  const timestamp = Date.now();
  const planJson = JSON.stringify({
    goal: "Keep plan revisions isolated",
    workItems: [],
    synthesis: { requiredEvidence: [], finalAnswerContract: "Return the current result" },
  });
  for (const [planRevisionId, revisionNo] of [[OLD_PLAN_ID, 1], [CURRENT_PLAN_ID, 2]] as const) {
    database.db
      .prepare(
        `INSERT INTO plan_revisions(id, run_id, revision_no, plan_json, digest, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(planRevisionId, RUN_ID, revisionNo, planJson, `digest-${revisionNo}`, timestamp + revisionNo);
  }

  const insertWorkItem = database.db.prepare(
    `INSERT INTO work_items(
      id, run_id, plan_revision_id, logical_id, title, input_scope_json, dependencies_json,
      required_capabilities_json, candidate_agent_ids_json, acceptance_criteria_json,
      risk_level, side_effect_class, assigned_agent_id, status, revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '[]', ?, '[]', '["worker"]', '[]',
      'LOW', 'READ_ONLY', 'worker', ?, 1, ?, ?)`,
  );
  insertWorkItem.run(
    "work-old-research",
    RUN_ID,
    OLD_PLAN_ID,
    "research",
    "Old research",
    "[]",
    "READY",
    timestamp,
    timestamp,
  );
  insertWorkItem.run(
    "work-old-review",
    RUN_ID,
    OLD_PLAN_ID,
    "review",
    "Old review",
    '["research"]',
    "NEEDS_INTERVENTION",
    timestamp + 1,
    timestamp + 1,
  );
  insertWorkItem.run(
    "work-current-research",
    RUN_ID,
    CURRENT_PLAN_ID,
    "research",
    "Current research",
    "[]",
    "READY",
    timestamp + 2,
    timestamp + 2,
  );
  insertWorkItem.run(
    "work-current-review",
    RUN_ID,
    CURRENT_PLAN_ID,
    "review",
    "Current review",
    '["research"]',
    "BLOCKED",
    timestamp + 3,
    timestamp + 3,
  );
  database.db
    .prepare("UPDATE collaboration_runs SET current_plan_revision_id = ?, status = 'RUNNING' WHERE id = ?")
    .run(CURRENT_PLAN_ID, RUN_ID);

  const getWorkItem = (id: string) => database.db.prepare("SELECT * FROM work_items WHERE id = ?").get(id) as CurrentPlanSqlRow;
  return {
    database,
    repository: new CurrentPlanScopeRepository(database),
    oldResearch: getWorkItem("work-old-research"),
    currentResearch: getWorkItem("work-current-research"),
    currentReview: getWorkItem("work-current-review"),
  };
}

function insertAttempt(
  database: CollaborationDatabase,
  params: { id: string; workItemId: string; status: string; createdAt: number },
): void {
  database.db
    .prepare(
      `INSERT INTO attempts(
        id, run_id, work_item_id, kind, attempt_no, idempotency_key, worker_agent_id,
        worker_owner_session_key, child_session_key, status, input_json, revision, created_at, updated_at
      ) VALUES (?, ?, ?, 'WORKER', 1, ?, 'worker', 'agent:worker:main', ?, ?, '{}', 1, ?, ?)`,
    )
    .run(
      params.id,
      RUN_ID,
      params.workItemId,
      `effect-${params.id}`,
      `agent:worker:subagent:${params.id}`,
      params.status,
      params.createdAt,
      params.createdAt,
    );
}

function insertEvidence(
  database: CollaborationDatabase,
  params: { id: string; workItemId: string; attemptId: string; reference: string; createdAt: number },
): void {
  database.db
    .prepare(
      `INSERT INTO evidence(
        id, run_id, work_item_id, attempt_id, type, title, reference,
        verification, digest, created_at
      ) VALUES (?, ?, ?, ?, 'analysis', 'Verified result', ?, 'checked', ?, ?)`,
    )
    .run(
      params.id,
      RUN_ID,
      params.workItemId,
      params.attemptId,
      params.reference,
      `digest-${params.id}`,
      params.createdAt,
    );
}

test("runtime selectors and aggregate settlement are scoped to the current plan revision", () => {
  const fixture = createFixture();
  const { database, repository } = fixture;
  try {
    const timestamp = Date.now();
    insertAttempt(database, {
      id: "attempt-old-running",
      workItemId: "work-old-research",
      status: "RUNNING",
      createdAt: timestamp,
    });
    insertAttempt(database, {
      id: "attempt-current-unknown",
      workItemId: "work-current-research",
      status: "UNKNOWN",
      createdAt: timestamp + 1,
    });

    assert.deepEqual(
      repository.listReadyWorkItems(RUN_ID, 10).map((item) => String(item.id)),
      ["work-current-research"],
    );
    assert.deepEqual(
      repository.listActiveWorkerAttempts(RUN_ID).map((attempt) => String(attempt.id)),
      ["attempt-current-unknown"],
    );
    assert.deepEqual(
      repository.listActiveAttemptsForLogicalIds(RUN_ID, ["research"]).map((attempt) => String(attempt.id)),
      ["attempt-current-unknown"],
    );
    assert.deepEqual(repository.synthesisReadiness(RUN_ID, ["research", "review"]), {
      ready: false,
      unsettledWorkItemIds: [],
      activeAttemptIds: ["attempt-current-unknown"],
    });
    assert.equal(repository.allRequiredItemsSettled(RUN_ID), false);

    database.db
      .prepare("UPDATE attempts SET status = 'CANCELLED' WHERE id = 'attempt-current-unknown'")
      .run();
    database.db
      .prepare("UPDATE work_items SET status = 'SUCCEEDED' WHERE plan_revision_id = ?")
      .run(CURRENT_PLAN_ID);
    assert.equal(repository.allRequiredItemsSettled(RUN_ID), true);
    assert.deepEqual(repository.synthesisReadiness(RUN_ID), {
      ready: true,
      unsettledWorkItemIds: [],
      activeAttemptIds: [],
    });
  } finally {
    database.close();
  }
});

test("synthesis and dependency evidence never cross a plan revision", () => {
  const fixture = createFixture();
  const { database, repository, currentReview } = fixture;
  try {
    const timestamp = Date.now();
    insertAttempt(database, {
      id: "attempt-old-evidence",
      workItemId: "work-old-research",
      status: "SUCCEEDED",
      createdAt: timestamp,
    });
    insertAttempt(database, {
      id: "attempt-current-evidence",
      workItemId: "work-current-research",
      status: "SUCCEEDED",
      createdAt: timestamp + 1,
    });
    insertEvidence(database, {
      id: "evidence-old",
      workItemId: "work-old-research",
      attemptId: "attempt-old-evidence",
      reference: "historical-reference",
      createdAt: timestamp,
    });
    insertEvidence(database, {
      id: "evidence-current",
      workItemId: "work-current-research",
      attemptId: "attempt-current-evidence",
      reference: "current-reference",
      createdAt: timestamp + 1,
    });

    assert.deepEqual(
      repository.listSynthesisEvidence(RUN_ID).map((evidence) => String(evidence.reference)),
      ["current-reference"],
    );
    assert.deepEqual(
      repository.listUpstreamEvidence(RUN_ID, currentReview, ["research"])
        .map((evidence) => String(evidence.reference)),
      ["current-reference"],
    );
    assert.throws(
      () => repository.listUpstreamEvidence(RUN_ID, fixture.oldResearch, ["research"]),
      (error: unknown) => error instanceof CollaborationError && error.code === "REVISION_CONFLICT",
    );
  } finally {
    database.close();
  }
});

test("partial waivers update only current-plan logical ids", () => {
  const fixture = createFixture();
  const { database, repository } = fixture;
  try {
    const changed = repository.waiveItemsByLogicalIds(RUN_ID, ["research", "review"], Date.now());
    assert.equal(changed, 2);
    assert.deepEqual(
      (database.db
        .prepare("SELECT status FROM work_items WHERE plan_revision_id = ? ORDER BY logical_id")
        .all(CURRENT_PLAN_ID) as Array<{ status: string }>).map((item) => item.status),
      ["WAIVED", "WAIVED"],
    );
    assert.deepEqual(
      (database.db
        .prepare("SELECT status FROM work_items WHERE plan_revision_id = ? ORDER BY logical_id")
        .all(OLD_PLAN_ID) as Array<{ status: string }>).map((item) => item.status),
      ["READY", "NEEDS_INTERVENTION"],
    );
  } finally {
    database.close();
  }
});

test("aggregate settlement fails closed when the current plan pointer is missing", () => {
  const fixture = createFixture();
  const { database, repository } = fixture;
  try {
    database.db
      .prepare("UPDATE collaboration_runs SET current_plan_revision_id = NULL WHERE id = ?")
      .run(RUN_ID);
    assert.throws(
      () => repository.allRequiredItemsSettled(RUN_ID),
      (error: unknown) => error instanceof CollaborationError && error.code === "NOT_FOUND",
    );
  } finally {
    database.close();
  }
});
