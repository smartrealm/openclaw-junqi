import type { SQLOutputValue } from "node:sqlite";
import { CollaborationDatabase } from "./database.js";
import { CollaborationError, assertCondition } from "./errors.js";
import {
  PERSISTENCE_LIMITS,
  assertBoundedJson,
  assertBoundedText,
  assertPersistableText,
  sanitizeStoredJsonForOutput,
} from "./persistence-policy.js";
import {
  assertWorkflowTemplateName,
  parseWorkflowTemplateDefinition,
  type WorkflowTemplateDefinition,
} from "./workflow-template-domain.js";
import { newId, nowMs, sha256, stableStringify } from "./util.js";

type SqlRow = Record<string, SQLOutputValue>;

export interface WorkflowTemplateVersionRecord {
  id: string;
  templateId: string;
  versionNo: number;
  digest: string;
  definition: WorkflowTemplateDefinition;
  sourceRunId: string | null;
  sourcePlanRevisionId: string | null;
  createdBy: string;
  createdAt: number;
}

export interface WorkflowTemplateRecord {
  id: string;
  name: string;
  status: "PUBLISHED" | "ARCHIVED";
  sourceRunId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  currentVersion: WorkflowTemplateVersionRecord;
}

export interface WorkflowRunTemplateLink {
  runId: string;
  templateId: string;
  templateVersionId: string;
  parameterDigest: string;
  createdAt: number;
}

function numberValue(value: SQLOutputValue | undefined): number {
  return typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : 0;
}

function nullableString(value: SQLOutputValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function parseDefinition(value: SQLOutputValue | undefined): WorkflowTemplateDefinition {
  if (typeof value !== "string") {
    throw new CollaborationError("INVALID_RESPONSE", "Stored workflow template definition is missing");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CollaborationError("INVALID_RESPONSE", "Stored workflow template definition is invalid");
  }
  return parseWorkflowTemplateDefinition(parsed, { maxWorkItems: PERSISTENCE_LIMITS.workItemArrayItems });
}

/** SQLite ownership boundary for versioned, reusable workflow definitions. */
export class WorkflowTemplateRepository {
  constructor(private readonly database: CollaborationDatabase) {}

  createPublishedFromRun(params: {
    name: string;
    definition: WorkflowTemplateDefinition;
    sourceRunId: string;
    sourcePlanRevisionId: string;
    actor: string;
  }): WorkflowTemplateRecord {
    const name = assertWorkflowTemplateName(params.name);
    const actor = assertBoundedText(params.actor, "workflow template actor", PERSISTENCE_LIMITS.actorBytes);
    const definition = parseWorkflowTemplateDefinition(params.definition, {
      maxWorkItems: PERSISTENCE_LIMITS.workItemArrayItems,
    });
    assertBoundedJson(definition, "workflow template definition", PERSISTENCE_LIMITS.workflowTemplateDefinitionBytes);
    const id = newId("template");
    const versionId = newId("template_version");
    const now = nowMs();
    const digest = sha256(definition);
    this.database.db
      .prepare(
        `INSERT INTO workflow_templates(
          id, name, status, current_version_id, source_run_id, created_by, created_at, updated_at
        ) VALUES (?, ?, 'PUBLISHED', ?, ?, ?, ?, ?)`,
      )
      .run(id, name, versionId, params.sourceRunId, actor, now, now);
    this.database.db
      .prepare(
        `INSERT INTO workflow_template_versions(
          id, template_id, version_no, definition_json, digest, source_run_id,
          source_plan_revision_id, created_by, created_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        versionId,
        id,
        stableStringify(definition),
        digest,
        params.sourceRunId,
        params.sourcePlanRevisionId,
        actor,
        now,
      );
    return this.requirePublished(id);
  }

  listPublished(limit: number = PERSISTENCE_LIMITS.workflowTemplates): WorkflowTemplateRecord[] {
    const boundedLimit = Math.max(1, Math.min(PERSISTENCE_LIMITS.workflowTemplates, limit));
    const rows = this.database.db
      .prepare(
        `SELECT t.*, v.id AS version_id, v.template_id AS version_template_id, v.version_no,
          v.definition_json, v.digest, v.source_run_id AS version_source_run_id,
          v.source_plan_revision_id, v.created_by AS version_created_by, v.created_at AS version_created_at
         FROM workflow_templates t
         JOIN workflow_template_versions v ON v.id = t.current_version_id
         WHERE t.status = 'PUBLISHED'
         ORDER BY t.updated_at DESC, t.id DESC
         LIMIT ?`,
      )
      .all(boundedLimit) as SqlRow[];
    return rows.map((row) => this.map(row));
  }

  requirePublished(id: string): WorkflowTemplateRecord {
    const row = this.database.db
      .prepare(
        `SELECT t.*, v.id AS version_id, v.template_id AS version_template_id, v.version_no,
          v.definition_json, v.digest, v.source_run_id AS version_source_run_id,
          v.source_plan_revision_id, v.created_by AS version_created_by, v.created_at AS version_created_at
         FROM workflow_templates t
         JOIN workflow_template_versions v ON v.id = t.current_version_id
         WHERE t.id = ? AND t.status = 'PUBLISHED'`,
      )
      .get(id) as SqlRow | undefined;
    if (!row) throw new CollaborationError("NOT_FOUND", `Workflow template ${id} was not found`);
    return this.map(row);
  }

  linkRun(params: {
    runId: string;
    templateId: string;
    templateVersionId: string;
    parameters: Record<string, unknown>;
  }): WorkflowRunTemplateLink {
    assertBoundedJson(params.parameters, "workflow template parameters", PERSISTENCE_LIMITS.workflowTemplateParametersBytes);
    const createdAt = nowMs();
    const parameterDigest = sha256(params.parameters);
    this.database.db
      .prepare(
        `INSERT INTO workflow_run_templates(
          run_id, template_id, template_version_id, parameters_json, parameter_digest, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.runId,
        params.templateId,
        params.templateVersionId,
        stableStringify(params.parameters),
        parameterDigest,
        createdAt,
      );
    return {
      runId: params.runId,
      templateId: params.templateId,
      templateVersionId: params.templateVersionId,
      parameterDigest,
      createdAt,
    };
  }

  getRunLink(runId: string): WorkflowRunTemplateLink | null {
    const row = this.database.db
      .prepare(
        `SELECT run_id, template_id, template_version_id, parameter_digest, created_at
         FROM workflow_run_templates WHERE run_id = ?`,
      )
      .get(runId) as SqlRow | undefined;
    if (!row) return null;
    return {
      runId: String(row.run_id),
      templateId: String(row.template_id),
      templateVersionId: String(row.template_version_id),
      parameterDigest: String(row.parameter_digest),
      createdAt: numberValue(row.created_at),
    };
  }

  getRunProjection(runId: string): Record<string, unknown> | null {
    const row = this.database.db
      .prepare(
        `SELECT l.run_id, l.template_id, l.template_version_id, l.parameter_digest, l.created_at,
          t.name AS template_name, v.version_no, v.digest AS template_digest
         FROM workflow_run_templates l
         JOIN workflow_templates t ON t.id = l.template_id
         JOIN workflow_template_versions v ON v.id = l.template_version_id
         WHERE l.run_id = ?`,
      )
      .get(runId) as SqlRow | undefined;
    if (!row) return null;
    return {
      templateId: String(row.template_id),
      templateVersionId: String(row.template_version_id),
      templateName: assertWorkflowTemplateName(row.template_name),
      templateVersionNo: numberValue(row.version_no),
      templateDigest: String(row.template_digest),
      parameterDigest: String(row.parameter_digest),
      instantiatedAt: numberValue(row.created_at),
    };
  }

  toPublicRecord(template: WorkflowTemplateRecord): Record<string, unknown> {
    return {
      id: template.id,
      name: template.name,
      status: template.status,
      sourceRunId: template.sourceRunId,
      createdBy: template.createdBy,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      currentVersion: {
        id: template.currentVersion.id,
        templateId: template.currentVersion.templateId,
        versionNo: template.currentVersion.versionNo,
        digest: template.currentVersion.digest,
        sourceRunId: template.currentVersion.sourceRunId,
        sourcePlanRevisionId: template.currentVersion.sourcePlanRevisionId,
        createdBy: template.currentVersion.createdBy,
        createdAt: template.currentVersion.createdAt,
        definition: sanitizeStoredJsonForOutput(
          template.currentVersion.definition,
          "workflow template definition",
          PERSISTENCE_LIMITS.workflowTemplateDefinitionBytes,
        ),
      },
    };
  }

  private map(row: SqlRow): WorkflowTemplateRecord {
    const status = String(row.status);
    assertCondition(
      status === "PUBLISHED" || status === "ARCHIVED",
      "INVALID_RESPONSE",
      "Stored workflow template status is invalid",
    );
    const templateId = String(row.id);
    const versionTemplateId = String(row.version_template_id);
    assertCondition(
      versionTemplateId === templateId,
      "INVALID_RESPONSE",
      "Workflow template version belongs to another template",
    );
    return {
      id: templateId,
      name: assertWorkflowTemplateName(row.name),
      status,
      sourceRunId: nullableString(row.source_run_id),
      createdBy: assertPersistableText(String(row.created_by), "workflow template actor", PERSISTENCE_LIMITS.actorBytes),
      createdAt: numberValue(row.created_at),
      updatedAt: numberValue(row.updated_at),
      currentVersion: {
        id: String(row.version_id),
        templateId: versionTemplateId,
        versionNo: numberValue(row.version_no),
        digest: String(row.digest),
        definition: parseDefinition(row.definition_json),
        sourceRunId: nullableString(row.version_source_run_id),
        sourcePlanRevisionId: nullableString(row.source_plan_revision_id),
        createdBy: assertPersistableText(
          String(row.version_created_by),
          "workflow template version actor",
          PERSISTENCE_LIMITS.actorBytes,
        ),
        createdAt: numberValue(row.version_created_at),
      },
    };
  }
}
