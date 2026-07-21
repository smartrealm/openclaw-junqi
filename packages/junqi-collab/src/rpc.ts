import { CollaborationError, RequestValidationError } from "./errors.js";
import type { OpenClawApi } from "./sdk-types.js";
import type { CollaborationService } from "./service.js";

type Handler = (service: CollaborationService, params: Record<string, unknown>) => unknown | Promise<unknown>;

const UNKNOWN_ERROR_MESSAGE = "JunQi collaboration operation failed";

interface RpcErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

function rpcErrorPayload(error: unknown): RpcErrorPayload {
  if (error instanceof RequestValidationError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof CollaborationError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return { code: "INTERNAL_ERROR", message: UNKNOWN_ERROR_MESSAGE };
}

interface RpcDefinition {
  method: `junqi.collab.${string}`;
  scope: "operator.read" | "operator.write";
  handle: Handler;
}

const READ_METHODS: readonly RpcDefinition[] = [
  { method: "junqi.collab.capabilities", scope: "operator.read", handle: (service) => service.capabilities() },
  { method: "junqi.collab.plan.get", scope: "operator.read", handle: (service, params) => service.getPlan(params) },
  { method: "junqi.collab.run.get", scope: "operator.read", handle: (service, params) => service.getRun(params) },
  { method: "junqi.collab.run.list", scope: "operator.read", handle: (service, params) => service.listRuns(params) },
  { method: "junqi.collab.run.listBySession", scope: "operator.read", handle: (service, params) => service.listRunsBySession(params) },
  { method: "junqi.collab.tombstone.list", scope: "operator.read", handle: (service, params) => service.listTombstones(params) },
  { method: "junqi.collab.events.list", scope: "operator.read", handle: (service, params) => service.listEvents(params) },
  { method: "junqi.collab.run.partial.preview", scope: "operator.read", handle: (service, params) => service.partialPreview(params) },
  { method: "junqi.collab.run.delete.preview", scope: "operator.read", handle: (service, params) => service.deletePreview(params) },
  { method: "junqi.collab.run.delete.get", scope: "operator.read", handle: (service, params) => service.deleteJobGet(params) },
  { method: "junqi.collab.session.mutationImpact", scope: "operator.read", handle: (service, params) => service.sessionMutationImpact(params) },
  { method: "junqi.collab.export.get", scope: "operator.read", handle: (service, params) => service.exportGet(params) },
  { method: "junqi.collab.export.download", scope: "operator.read", handle: (service, params) => service.exportDownload(params) },
  { method: "junqi.collab.maintenance.status", scope: "operator.read", handle: (service) => service.maintenanceStatus() },
  { method: "junqi.collab.workflow.template.list", scope: "operator.read", handle: (service, params) => service.listWorkflowTemplates(params) },
] as const;

const WRITE_METHODS: readonly RpcDefinition[] = [
  { method: "junqi.collab.plan.create", scope: "operator.write", handle: (service, params) => service.createPlan(params) },
  { method: "junqi.collab.plan.revise", scope: "operator.write", handle: (service, params) => service.revisePlan(params) },
  { method: "junqi.collab.plan.approve", scope: "operator.write", handle: (service, params) => service.approvePlan(params) },
  { method: "junqi.collab.run.dispatch.stop", scope: "operator.write", handle: (service, params) => service.stopDispatch(params) },
  { method: "junqi.collab.run.dispatch.resume", scope: "operator.write", handle: (service, params) => service.resumeDispatch(params) },
  { method: "junqi.collab.run.partial.accept", scope: "operator.write", handle: (service, params) => service.acceptPartial(params) },
  { method: "junqi.collab.run.cancel", scope: "operator.write", handle: (service, params) => service.cancelRun(params) },
  { method: "junqi.collab.run.reconcile", scope: "operator.write", handle: (service, params) => service.reconcileRun(params) },
  { method: "junqi.collab.run.clone", scope: "operator.write", handle: (service, params) => service.cloneRun(params) },
  { method: "junqi.collab.workflow.template.createFromRun", scope: "operator.write", handle: (service, params) => service.createWorkflowTemplateFromRun(params) },
  { method: "junqi.collab.workflow.template.instantiate", scope: "operator.write", handle: (service, params) => service.instantiateWorkflowTemplate(params) },
  { method: "junqi.collab.run.archive", scope: "operator.write", handle: (service, params) => service.archiveRun(params, true) },
  { method: "junqi.collab.run.unarchive", scope: "operator.write", handle: (service, params) => service.archiveRun(params, false) },
  { method: "junqi.collab.run.delete", scope: "operator.write", handle: (service, params) => service.deleteRun(params) },
  { method: "junqi.collab.run.delete.retry", scope: "operator.write", handle: (service, params) => service.retryDelete(params) },
  { method: "junqi.collab.workItem.input.append", scope: "operator.write", handle: (service, params) => service.appendWorkItemInput(params) },
  { method: "junqi.collab.workItem.reassign", scope: "operator.write", handle: (service, params) => service.reassignWorkItem(params) },
  { method: "junqi.collab.workItem.retry", scope: "operator.write", handle: (service, params) => service.retryWorkItem(params) },
  { method: "junqi.collab.workItem.cancel", scope: "operator.write", handle: (service, params) => service.cancelWorkItem(params) },
  { method: "junqi.collab.attempt.resolveUnknown", scope: "operator.write", handle: (service, params) => service.resolveUnknownAttempt(params) },
  { method: "junqi.collab.delivery.retry", scope: "operator.write", handle: (service, params) => service.retryDelivery(params) },
  { method: "junqi.collab.delivery.retarget", scope: "operator.write", handle: (service, params) => service.retargetDelivery(params) },
  { method: "junqi.collab.delivery.abandon", scope: "operator.write", handle: (service, params) => service.abandonDelivery(params) },
  { method: "junqi.collab.session.mutation.prepare", scope: "operator.write", handle: (service, params) => service.prepareSessionMutation(params) },
  { method: "junqi.collab.session.mutation.complete", scope: "operator.write", handle: (service, params) => service.completeSessionMutation(params) },
  { method: "junqi.collab.export.create", scope: "operator.write", handle: (service, params) => service.createExport(params) },
  { method: "junqi.collab.maintenance.enter", scope: "operator.write", handle: (service, params) => service.enterMaintenance(params) },
  { method: "junqi.collab.maintenance.exit", scope: "operator.write", handle: (service, params) => service.exitMaintenance(params) },
] as const;

export const COLLABORATION_RPC_METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export function registerCollaborationRpc(api: OpenClawApi, getService: () => CollaborationService | null): void {
  for (const definition of COLLABORATION_RPC_METHODS) {
    api.registerGatewayMethod(
      definition.method,
      async ({ params, respond }) => {
        const service = getService();
        if (!service) {
          respond(false, undefined, {
            code: "UNAVAILABLE",
            message: "JunQi collaboration service is not running",
          });
          return;
        }
        try {
          respond(true, await definition.handle(service, params));
        } catch (error) {
          respond(false, undefined, rpcErrorPayload(error));
        }
      },
      { scope: definition.scope },
    );
  }
}
