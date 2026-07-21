# OpenClaw Collaboration

This context governs durable multi-agent collaboration that begins from a
verified OpenClaw chat message and is executed through OpenClaw Agents, Tasks,
and Managed Flows.

## Language

**Workflow Template**:
A reusable, published definition of a collaboration graph and its execution
constraints. It has no execution history and does not bind a concrete Agent.
_Avoid_: Saved run, cloned workflow

**Workflow Template Version**:
An immutable published revision of a Workflow Template. A new definition is a
new version rather than a mutation of a prior version.
_Avoid_: Editable template, latest template data

**Workflow Run**:
One durable execution of a plan against an exact OpenClaw origin message. It is
an audit record, not a reusable definition.
_Avoid_: Workflow, template instance

**Instantiation**:
The act of creating a new Workflow Run from a Workflow Template Version and a
verified OpenClaw origin. It resolves current Agent candidates and requires a
fresh approval before execution.
_Avoid_: Replay, resume, copy run

**Approval Decision**:
A durable operator decision bound to an exact plan revision and its Agent
assignments. It is distinct from the plan itself and remains part of a Run's
audit trail.
_Avoid_: Approval state, approved workflow

**Graph Projection**:
A read-only node-and-edge representation derived from a Workflow Run's current
work items. It never changes orchestration state.
_Avoid_: Workflow engine, visual workflow
