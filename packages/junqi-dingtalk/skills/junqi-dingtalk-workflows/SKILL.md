---
name: junqi-dingtalk-workflows
description: Use JunQi DingTalk tools for daily briefings, meeting lifecycle, Minutes follow-up, knowledge lookup, reviewed chat sends, and report or mail drafts.
---

# JunQi DingTalk workflows

Use this Skill only for workflows backed by the registered JunQi DingTalk tools. Do not execute a command-line program, invent a tool, or imply that an absent send, submit, delete, or high-sensitivity write capability exists.

## Global rules

1. Call `junqi_dingtalk_runtime_status` first. Stop if the runtime is unavailable or the required exact profile is not active.
2. Keep one exact `<corpId>:<userId>` profile for the whole workflow. Never transfer identifiers or results between profiles.
3. Before the first call to each business tool, call `junqi_dingtalk_tool_schema` with its exact tool name. Build `arguments` only from the returned schema and fail closed on schema errors.
4. Derive people, rooms, events, tasks, approvals, Minutes, documents, and messages from actual read results. Never guess an identifier, time, target, or permission.
5. A single match may be selected. Zero matches, multiple plausible matches, truncated results, or failed reads require clarification or another bounded read.
6. Independent reads may run concurrently. Serialize writes, preserve the result of every step, and never treat a multi-step workflow as an atomic transaction.
7. Before a write, state the exact target and change and ensure that the current user request authorizes it. OpenClaw approval and the tool result remain authoritative.
8. Accept a write as complete only when its result reports verified evidence for the same stable resource. Treat unverified or unknown results as unresolved, do not replay the write, and offer an authoritative read or manual reconciliation.
9. Distinguish empty data from a failed or incomplete read. Report partial success per source or per item.
10. Keep sensitive source content in the active response only as needed. Do not ask JunQi to persist business content in local activity records.

## Daily work assistant

1. Read `junqi_dingtalk_calendar_today`, `junqi_dingtalk_todo_overdue`, `junqi_dingtalk_todo_due_today`, and `junqi_dingtalk_approval_pending` for the same profile. These four reads are independent and may run concurrently after their schemas are verified.
2. Treat the briefing as a local response projection, not as a new OpenClaw task, transaction, or persisted DingTalk object. Never infer an empty source from a failed command or from a response shape that its current schema does not declare.
3. Produce four separate source sections: today's schedule, overdue unfinished Todos, Todos due today, and pending approvals. Preserve stable event, task, and approval references when the source provides them, and include relevant times, owners, priority, due state, and incomplete-read evidence.
4. Put schedule conflicts first, then overdue Todos, urgent Todos due today, time-sensitive approvals, remaining events, and remaining due-today Todos. Do not invent urgency when the source has no priority or deadline evidence.
5. If one source fails, present the other source sections and mark only the failed source unavailable. Do not perform writes, complete Todos, approve requests, send messages, or create follow-up items from a briefing request.

## Meeting planning and creation

1. Collect the title, duration, time zone, allowed time window, participants, and room requirements. Ask only for missing facts that materially change the booking.
2. Resolve each participant with `junqi_dingtalk_contact_search_users`. Require one unambiguous user identity for every attendee.
3. For a flexible window, use `junqi_dingtalk_calendar_suggested_times`. For an exact candidate, use `junqi_dingtalk_calendar_busy`. Resolve a room with `junqi_dingtalk_calendar_rooms` when requested.
4. Present the exact start, end, participants, room, title, and profile before writing. When authorized, call `junqi_dingtalk_calendar_create` once.
5. Require the create result to contain verified evidence and a stable event identifier. Then read the same event with `junqi_dingtalk_calendar_event` and its participants with `junqi_dingtalk_calendar_attendees`.
6. Report missing participants, room mismatch, unverified results, or readback failure as partial or unresolved. Do not create a replacement event automatically.
7. For a requested reschedule or attendee change, first read the stable event, show the exact field and participant delta, then call `junqi_dingtalk_calendar_update` once after explicit confirmation. Require verified evidence for the same event ID and read its detail and attendees again.
8. Cancel only when the user explicitly requests deletion of one exact stable event. Read its detail first, show the exact event ID, title, time, and affected attendees, then call `junqi_dingtalk_calendar_cancel` once after explicit confirmation. Accept completion only when DWS returns verified evidence for the same event ID. An unknown result must never be retried automatically.

## Meeting Minutes and follow-up

1. Use `junqi_dingtalk_minutes_latest` only when the user explicitly requests the latest Minutes. For a named or dated meeting, use `junqi_dingtalk_minutes_search` with the title or bounded time range.
2. Require one unambiguous stable Minutes task identifier, then read `junqi_dingtalk_minutes_detail`, `junqi_dingtalk_minutes_transcript`, and `junqi_dingtalk_minutes_action_items` for that same item. Pass the exact task identifier to the transcript tool; never request the latest item, a cursor, a keyword-selected item, or single-page output.
3. Draft Todos or reports from the transcript only when its `taskUuid` matches the selected item and `complete` is true. Otherwise report the transcript as unresolved and do not infer missing content.
4. Show the proposed Todo title, owner, due time, and source Minutes reference for every action item. Do not create Todos until the user confirms the exact batch.
5. After confirmation, call `junqi_dingtalk_todo_create` sequentially. Keep a per-item ledger of verified, unresolved, and failed results. Never retry an unknown item automatically.
6. For a daily or weekly report request, draft the report in the response from the selected Minutes. `junqi_dingtalk_report_latest` or `junqi_dingtalk_report_outbox` may provide style context. Do not submit until the user has reviewed the exact draft and explicitly asks to submit it.

## Documents and knowledge

1. Search with `junqi_dingtalk_doc_search`, `junqi_dingtalk_wiki_space_search`, or `junqi_dingtalk_wiki_node_search` using the smallest sufficient scope.
2. Require a stable, unambiguous result before fetching content with `junqi_dingtalk_doc_fetch`.
3. Preserve source references and distinguish access denial, incomplete pagination, no result, and empty content.

## Reports, messages, and mail drafts

1. Use `junqi_dingtalk_report_inbox`, `junqi_dingtalk_report_outbox`, or `junqi_dingtalk_report_latest` as read evidence for summaries and report drafts.
2. Before submission, call `junqi_dingtalk_report_template_search`, then `junqi_dingtalk_report_template`, and build contents only from the returned template field definitions. Do not guess a template ID, field name, sort value, content type, or recipient.
3. Show the complete draft, template, and recipients to the user. Call `junqi_dingtalk_report_submit` only after the user explicitly asks to submit that exact version. Require a same-reportId detail read, but preserve `succeeded_unverified` because the formal detail contract does not prove every submitted field and recipient. Never replay the submission.
4. Use `junqi_dingtalk_chat_unread`, `junqi_dingtalk_chat_at_me`, or `junqi_dingtalk_chat_search` to gather message context.
5. Use `junqi_dingtalk_mail_triage`, `junqi_dingtalk_mail_search`, and `junqi_dingtalk_mail_message` to gather mail context from stable results.
6. Produce chat and mail responses as drafts in the OpenClaw conversation and ask the user to review them. Mail has no registered send tool.
7. Send chat only after the user confirms the exact profile, stable group ID or openDingTalkId, and complete text. Call `junqi_dingtalk_chat_send` once with a new operation-specific idempotency key. Do not use a name, search query, bot, webhook, attachment, media, mention, or batch target.
8. If the send result remains unknown because the asynchronous task is pending, use `junqi_dingtalk_chat_send_status` with the returned task ID. After it returns both message and conversation IDs, use `junqi_dingtalk_chat_messages_by_ids` for the exact message ID and require its base-message completeness evidence. Never reuse the send tool to reconcile an uncertain result.
9. Preserve `succeeded_unverified` after an exact-ID read because the formal read contract does not prove the entire submitted body and recipient postcondition. Report a target mismatch, absent message ID, failed read, or pending task as unresolved.
