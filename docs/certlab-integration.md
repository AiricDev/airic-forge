# CertLab single-App integration

Status: B1–B5 protocol, lifecycle, sources and original learning governance integrated, 2026-10-15.
Runtime now binds only CertLab. Legacy CertReporter adapters/seed remain inert,
and existing private runtime roots are not migrated or imported.
The canonical protocol lives in the CertLab repository at
`docs/api/assistant-protocol.md`; its batch plan is `docs/airic-integration-plan.md`.

## B5 learning and joint recovery

The user authorized B5. Original Work source observations, business receipts and human feedback
feed the existing Reflection/Proposal governance. Domain-knowledge lens supports bounded nested
SK/precedent Markdown and navigation README; delegation-gap remains limited to the actual WD.
The OM port registers candidate **paths**, the Git adapter resolves stable front-matter IDs,
and navigation README does not become a knowledge ID. Traversal and candidate symlinks are rejected.
Review and organization contribution diffs include precedents, not just flat SK/WD changes.

No new learning store or CertLab governance API. Author review/adoption, catalog validation,
stale/rebase locks and next-Turn activation remain authoritative. Old Turns, private drafts,
original source revisions and business facts are not rewritten or implicitly adopted.
Sharing organization main does not expose private Work/events or overwrite personal active HEADs.
Restart retains Git/SQLite/JSONL governance, not App tokens or web/ACP grants; rebootstrap/login.
The CertLab handoff renders the existing first-password flow and exact Work, never the App bearer.
The source `.airic` remains unchanged. B5 evidence/quality limits: CertLab `docs/airic-b5-record.md`.

## B4 material sources and the initial OM

CertLab publishes 14 queries and 15 commands. The four material queries delegate to the
original authorized AssetService/isolated reader. `asset.read` requires an immutable revision
and explicit page; it returns bounded text and sanitized PNG for PDF pages or PNG/JPEG.
PDF text is a text layer, not OCR or verified reading order; no verified region is implied.
Unreadable material never establishes conformity. DOCX/text preview pages are not printed pages.

Work observations persist original source/limits/counts, not raw material text or pixels.
Pi receives an actual tool-result image block, not base64 disguised as text. Text-only models
receive an explicit visual handoff. A fresh memory-only session does not persist tool contents;
model outputs may cite sources. The CertLab source viewer verifies original revision/page/digest
and warns about later adoption, without rebinding older analysis or confirming assessments.

The user-authorized initial OM can initialize a **new** institution root:
set `FORGE_SEED_PROJECT_DIR=/Users/leric/code/certlab/.airic` and
`FORGE_REPORT_WORK_DEFINITION=certification-assessment`, together with separate fresh project/data
directories and the original App/organization/model configuration. Do not use the source as runtime Git/data.
Only the three OM directories are imported; design/README/source materials are excluded.
Existing Git roots and personal branches are never overwritten by seed changes.
Work remains the report-authoring business category; the use case selects the actual WD,
records its ID/paths/HEAD per Turn and uses the same selection in existing Reflection consumers.
Knowledge IDs resolve to real nested Markdown paths at that HEAD, including precedents;
path traversal and seed symlinks are rejected. Read support does not expand proposal write paths.
Candidates remain candidates; full learning/adoption acceptance is B5, not implied by this batch.

B4 records and synthetic real-HTTP evidence live in CertLab `docs/airic-b4-record.md`.
No real-model or professional-quality acceptance was performed.

## B3 execution and handoffs

The App exposes 10 queries and 15 original-business commands. Non-assessment commands use
`AppPort.prepareCommand` to bind original resource/scope/target and current versions.
The original CertLab short transaction rechecks report impacts and atomically annotates
the original audit/receipt. Shared outside-report work is handed to a human, not split.
Unknown creations reconcile their original locator/key, never repeat a submission.
Project TestPlan/finding-export inputs retain all issued project work, including other reports.

`work-progress.ts` projects waiting from immutable observations/checkpoints/feedback.
The fixed Pi `record_work_checkpoint` tool records real same-Work references, concise checks,
uncertainty, next/remaining work and a resume condition; business calls stop at the checkpoint.
ACP `session/feedback` accepts explicit approve/correct/redo/knowledge/method/resume and optional
step/phase inspection arrangement, deduplicated by RPC ID. Resume reads current App facts.
Feedback cannot edit active OM or automatically create/adopt proposals. A queued Job, ended
reply or acknowledged step never completes the professional goal.
New seed WD enables B3; existing private branches and runtime roots are not migrated.
Catalog acceptance and owner-reviewed WD changes remain explicit governance steps.

Tests: `work-lifecycle.test.ts`, existing stage-flow regressions with explicit acknowledgements,
CertLab `test_assistant_business.py`, and `certlab-b3-live-probe.ts` through real loopback HTTP.
Batch evidence and limits are recorded in CertLab `docs/airic-b3-record.md`.

## Authorized direction

- Replace CertReporter, do not add a selectable second App or a multi-App platform.
- One Forge instance serves one CertLab App and one certification organization.
  The organization is the institution using CertLab, not the equipment applicant.
- Start with new Forge data/OM roots. Preserve existing CertReporter roots,
  databases, Git repositories and trajectories. No automatic migration/import.
- Trust the email returned by CertLab's authenticated server identity.
  Reuse the current CertLab bearer token, not a new agent token or SSO service.
- Complete A1–A3 in batches, beginning with a single-report assessment,
  tests/findings, human handoffs and delivery preparation.

## Boundary contracts

| Concern | Binding |
| --- | --- |
| Identity | `GET /api/v1/auth/me`: `actor_id`, `permissions`, `email`/`display_name`; browser email is not authoritative |
| Manifest | `/airic/v1/manifest`: `appId=certlab`, `domain.release=certlab/v1`, fixed `organizationId`, published typed capabilities |
| App port | Use-case-shaped identity/context/query/command/resource-receipt capabilities; HTTP and CertLab DTO mapping remain in adapters |
| Work | Default report entry atomically binds one private Work/session per owner/App/WorkType/entityId. New goal comes from active OM; opening never prompts. Explicit workId must match the bound conversation; bootstrap does not accept goal; histories do not merge |
| Versions | Assessment `record_no` and actual resource/affected-assessment tokens; no whole-report revision invented for concurrency |
| Receipts | `commandId` equals the original idempotency key; preserve capability, target, input and original resource/scope/key |
| Unknown | Resolve the original resource-scoped receipt; absence is not proof of failure; no blind retry with a new key |
| Audit | App effect/receipt/required correlation commit atomically; trajectory references App facts, not a second success ledger |
| OM | Each Turn uses the owner's active HEAD, accepted catalog and actual context digest; new accepted OM applies next Turn |
| Sources | AssetRevision/digest/page/region remain pinned; replacement does not relabel old derived analysis |

Token use is restricted to Authorization headers and runtime memory.
No token in ACP messages, model input, OM, JSONL, SQLite sessions, logs or URLs.
Existing in-memory Session tickets bind ACP channels, not a second user identity.
Restart requires bootstrap and reconciliation, not token restoration or automatic writes.

The ordinary App token cannot distinguish agent from human callers.
This design trusts the Forge backend and enforces a fixed tool/Agent-API allowlist.
It does not claim leaked tokens cannot call human APIs. Self-reported correlation
fields are never authorization evidence.

App authorization remains authoritative on every operation. Forge administrator
access cannot change the Work owner, swap credentials or grant project/professional
permissions. A new root must be bound to its organization; mismatched bindings
must not load old OM, user branches, caches or trajectories.

## Execution limits

Publish only the approved reads and commands in the canonical capability table.
Keep Assessment submit/confirm, report issue/send out of both tools and Agent API.
Keep asset upload/adoption and report scope/personnel maintenance human-operated
in this first integration. Shared-item changes affecting other reports require a
human handoff, not split writes or implicit scope expansion.

Project-wide issued TestPlan/finding export semantics remain unchanged.
Creating a Job is not completion, formal issue or delivery.
Checkpoint acceptance is not professional confirmation.

Stopping a Work blocks further tool writes and requests runner cancellation.
In-flight App commands and accepted Jobs may still complete; reconcile original
receipts, keep unknown outcomes and preserve already committed facts.
Do not reuse Reflection's background-continuation policy for business-writing Work.

## Frontend ownership

CertLab uses `@assistant-ui/react` and `@assistant-ui/react-markdown` with
`useExternalStoreRuntime`, its existing MUI theme and a thin ACP adapter.
Forge's `prototype/src/workbench/reflection/ReflectionChat.tsx` is a reference,
not a cross-repository import. No Assistant Cloud or new Tailwind/shadcn stack.
Stable server message IDs drive replay/deduplication; UI completion does not
imply command or goal completion. Cancel invokes real backend stop.

Reflection, Proposal review and OM governance stay in the existing Forge
workbench. CertLab links the same Work; it does not implement a second OM editor.

## Initial WD responsibility draft

The B1 seed at `seed/certlab/work-definitions/report-authoring` is installed only
in new roots. It allows four queries and three assessment commands. Broader
responsibilities below remain B3–B5 contracts, not executable capabilities.
Reuse the OM compiler and
governance mechanisms, not existing CertReporter private runtime knowledge.

- Input: explicit report goal/scope, authoritative adopted Clause/Schema,
  current resource tokens, catalog and the owner's active OM.
- Method: read actual sources, distinguish facts/inferences/uncertainty,
  execute only published/accepted/WD-allowed capabilities, then verify results.
- Checkpoints: initially wait at agreed business steps for engineer acceptance,
  correction or redo. Only an explicit engineer decision changes granularity.
- Handoffs: record human-only decisions, external tests/responses and cross-report
  shared-item effects; resume only after reading actual results and current tokens.
- Recovery: block new writes while a command is unresolved; reconcile its
  original receipt before continuing. Keep committed facts after interruption.
- Completion: compare actual business results and remaining work with the goal.
  A generated plan, completed reply, created Job or checkpoint is not completion.
- Learning: retain evidence/feedback for human Reflection; only author adoption
  changes later Turns. Do not automatically turn feedback into active OM.

The method belongs to WD/OM, not a new hardcoded App workflow engine.

## Batch gates

B0: preserve current worktree, record contracts and negative examples.
B1: replace App client/WD/catalog and test real synthetic identity/context/write,
rejection/conflict/resource-receipt recovery in fresh roots.
B2: assistant-ui, lifecycle, goal isolation, dirty protection and actual stop.
B3: execution/checkpoints/feedback/waiting and human handoffs.
B4: controlled document/image inputs and pinned provenance.
B5: actual trajectory→Reflection→author adoption→next Turn and joint recovery.

Domain/fake-port tests own Work policy. Adapter contract tests own HTTP mapping.
App integration owns authorization, SQLite transactions and receipts.
Browser tests own observable interaction. Later code batches run
`pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e` and the CertLab gates.
Mock models do not prove drawing quality or learning effectiveness.

Current baseline: HEAD `4cb44fd`, with existing Reflection streaming/readable
identity/UI/test work preserved. The CertLab B0 evidence snapshot records paths
and non-document hashes. B1/B2 were authorized and implemented; B3–B5 require
separate authorization. See CertLab `docs/airic-b1-record.md` and `docs/airic-b2-record.md`.

## B1 configuration and checks

Set `FORGE_CERTLAB_URL` (an HTTP(S) origin, default `http://127.0.0.1:8000`) and
`FORGE_ORGANIZATION_ID` to match CertLab's `CERTLAB_ORGANIZATION_ID`.
Default roots are `runtime/certlab/project` and `runtime/certlab/data`;
existing `FORGE_PROJECT_DIR` / `FORGE_DATA_DIR` overrides must point at fresh
roots. Nonempty unbound roots are rejected before Git/SQLite opens them.
The binding marker records the App, organization and canonical roots.

Runtime routes through `AppPort` and `CertLabClient`. Commands bind report scope,
re-read `assessment.context`, check `expected_record_no` and capture the original
project/scope/key locator before HTTP. Recovery never invents a second command.
Git OM writes use the environment's configured author identity.

Run `pnpm build`, `pnpm check`, `pnpm test`. For the synthetic two-repository probe,
run CertLab's `tools/verify_airic_b1.py --forge-root <absolute Forge root>` via
`uv run python`. It uses real HTTP with a deterministic fake Agent and temporary
databases/roots. It does not call an LLM or certify professional conclusions.
The current browser acceptance script still targets the legacy fixture and
writes tracked screenshots; B1 does not run it over existing user changes.
## B2 lifecycle and browser checks

New bootstrap requires `goal`; resume requires the original `workId` and checks
organization, App actor, owner, report and active status. Several active goals
for one report remain independent. Active checks read the original Work ID,
not the latest Work for that report. Legacy records lacking an explicit binding
are not silently assigned a new goal or actor.

ACP exposes `session/history`, `session/cancel` and `session/reconcile`.
Prompt RPC IDs identify accepted Turns: completed same-ID/same-input replay
returns original Turn/reply/provenance; changed input conflicts; unfinished
acceptance never creates another Turn. JSONL retains streaming text deltas,
and cancelled/interrupted text is not a complete reply.
Stop/disconnect cancels the runner, denies later tools and waits for in-flight
tool effects before returning. Committed App receipts survive cancellation;
pending/unknown actions retain their original resource locator.
Startup marks abandoned running Turns interrupted; it never restores tokens
or resubmits prompts/commands.

The CertLab panel uses assistant-ui 0.15.28 and react-markdown 0.14.22, links
the same Work, protects dirty editing and uses the App bearer only in HTTP
Authorization headers. Set `FORGE_ALLOWED_ORIGIN` to the CertLab page origin.
CertLab sets the same trusted Forge origin in `VITE_CERTLAB_FORGE_ORIGIN` and
`CERTLAB_FORGE_ORIGIN` for browser transport/CSP.

`work-lifecycle.test.ts` owns scope, stop/in-flight, partial-text, duplicate-ID,
restart and real ACP contracts. CertLab `frontend/e2e/assistant.spec.ts` runs
both real services and an isolated deterministic fake Agent through a browser.
Its local-only `certlab-browser-fixture.ts` preaccepts the synthetic catalog;
production catalog approval/governance is not bypassed.
See CertLab `frontend/README.md` for ports/build flags and final evidence.
The legacy Forge browser launcher remains skipped to preserve user screenshots.

## Batch materials and native source lookup

The additive `certlab/v1` catalog now includes `asset.search` and `asset.read-location`.
Search results are bounded project-authorized candidates with revision/hash/path/native locator,
index status and coverage. The new read binds exactly the requested revision and location ID;
typed PNG payloads retain the same B4 validation. Catalog acceptance and existing OM review
remain explicit; this code change does not rewrite active instance methodology.

Search snippets and read contents remain transient model input. `materialObservation` stores
only source projections, coverage and warnings. Seed methodology searches adopted sources,
tries meaningful alternate terms, then reads selected native positions; no upload/adoption tools.
The independent real-HTTP `certlab-material-search-probe.ts` verifies the search/refine/read
path, exact source validation, unchanged active OM and absence of OCR/text/snippets/pixels in
persistent history, using a temporary Forge runtime and no external model call.

## Work context budget (2026-10-16)

`packages/domain/src/work-context.ts` owns deterministic Work facts and bounded older-discussion memory.
`ContextSummaryPort` / `ContextSummaryStore` keep the model and private derived cache outside the domain;
`runtime.ts` composes `PiContextSummarizer` and `FileContextSummaryStore`.
`pi-context-budget.ts` projects each provider input, counts system/tools/images, replaces only exact repeated
material ranges and uses Work-specific summaries via the same Pi ModelRuntime.completeSimple interface. Pi system.toolsAdded already contains provider tool declarations; executable tools are not counted twice. The authoritative trajectory is never rewritten.
The default configured input cap is 256000 tokens with 8000 output tokens. The effective input budget is the smaller of the configured cap and 90% of the model context window minus the output budget; Work context is organized at 80% of that effective budget. Recent context may use up to 25% of the budget, capped at 64000 tokens. History below the 80% threshold is no longer summarized solely because it passed 8000 tokens.
Configure `FORGE_CONTEXT_INPUT_TOKENS` / `FORGE_CONTEXT_OUTPUT_TOKENS` when needed.
A failed summary or oversized mandatory context pauses further calls; committed App effects remain committed.
`asset.read` / `asset.read-location` default to 4000 Unicode code points (max 8000); pixels require
`include_image=true`. Persist the fixed `source.text_range`, not tool bodies. Current receipt requests use
`target_kind` / `target_id`, never the removed `assessment_id` transport field.
See CertLab `docs/context-budget.md` for the cross-repository contract and test mapping.

First-use repair: 80% is a soft organization target; the hard budget and model-window headroom still apply.
Work summaries reject empty, overlong, truncated and tool-call responses; the private cache fingerprint is v2.
`pi-work-agent-budget.test.ts` exercises actual Pi projection against a local model endpoint, ten-step
compaction without replay, and summary response/input failure contracts. Bootstrap also reports
`workspaceAvailable=false` when no built independent UI exists; missing UI routes return JSON 404.
Copilot App sessions do not require a separate Forge password setup.

## Report conversation entry (2026-10-16)

Bootstrap without workId creates or restores a durable report conversation using the actual configured work definition from the owner active OM. `report_conversations` is Forge-owned SQLite metadata keyed by owner/App/WorkType/entityId, atomically selecting/creating a Work under an IMMEDIATE transaction. It does not alter the CertLab database. First binding chooses the latest active existing Work for that App actor (updated_at, id descending), preserving its original goal/history; later unrelated Work records do not move this binding. Completed bindings fail closed rather than silently resetting. Sessions also use atomic lookup/create. Explicit workId must match the bound report conversation; the bootstrap goal field is removed.

CertLab uses a compact assistant-ui chat; checkpoint messages first record neutral resume feedback and then prompt. Grant renewal restores the same Work; neither opening nor reconnecting sends messages. Source/receipt and typed feedback tools remain in expandable details. Tests: `work-lifecycle.test.ts` durable report bootstrap/existing Work binding; CertLab assistant client and real fixture browser suite.

### Progressive material retrieval (2026-10-17)

Pi loads `apps/api/src/material-retrieval-prompt.ts` into the system prompt when the authorized tool set contains `asset.search`. Reuse supplied App context, inspect small coverage metadata, search a few candidates with alternate terms, then read only relevant fixed original locations. Full `asset.list` remains for explicit inventory, not startup. Pending/history candidates must be identified and cannot be silently adopted. Search snippets and visual summaries are discovery clues; failed/partial/unsupported coverage limits no-hit claims. This is runtime tool-use guidance, not a replacement for the pinned OM's professional method or App authorization.

`pi-work-agent-budget.test.ts` checks the actual SDK provider request receives the guidance. A real configured-model probe with synthetic materials completed coverage → targeted searches → one original location, with no full inventory or business writes. CertLab's live vision endpoint still needs a valid API credential before failed indexes can be retried successfully; a successful agent lookup probe does not establish real material coverage.

### Actual private Work Definition correction (2026-10-17)

A real continuation still fetched all assessments/materials because its active private WD omitted `asset.search` and `asset.read-location`; the former search-only prompt gate therefore skipped the guidance. Material-capable Works now always receive capability-aware guidance; missing search is an explicit configuration gap, never a reason for bulk inventory. The original owner's reviewed Reflection Proposal was adopted by explicit human confirmation as private revision `3d39a24570937e4998ac88ee94a53807750d3362`; organization main/other owners/seed source were not silently changed.

The Pi budget can now compact the last completed call/result group, including the first tool round. Oversized serialized groups are summarized in bounded Unicode fragments; Work serialization preserves result tails that the SDK coding serializer truncates. Image pixels/thinking are excluded from text memory. Exact command results remain fixed facts, preserving unknown outcomes and receipts. History and business state remain immutable; tools are not replayed. Local SDK contracts cover the original oversized-first-round failure shape; actual-data model validation is a separate authorization/acceptance item.

Actual-data verification was separately authorized by the human for the configured DeepSeek endpoint. It revealed that soft-pressure compaction erased fresh observations and restarted coverage checks. The final projection retains recent complete groups when possible, pins at most three exact unfiltered coverage observations by scope, and asks for five startup assessment summaries while preserving selection/schema/counts. Tests cover fresh-observation retention and the startup HTTP shape.

The final isolated read-only CP0 probe used the adopted real private OM, actual 79-assessment report and original conversation: initial 5 summaries / estimated 19933 tokens, one all-scope and one current-scope coverage query, completed reply and checkpoint. No full inventory, command attempt or original Work history mutation. The earlier timeout/step-limit probes were diagnostic failures, not acceptance passes. Temporary verification credentials were revoked. Final domain/API suite: 22/86 passed; CertLab backend: 1328 passed/7 platform skips.

## Work execution activity (2026-10-17)

`startTurn` emits bounded `WorkActivity` metadata through the authorized ACP connection as
`session/update` (`phase: activity`) and persists it as `message.payload.activity` in the
original Work trajectory. Each operation has a stable progress ID and running/terminal
updates with timestamps. Preparation, context assembly, model waiting/reply generation,
App queries/commands, history/document reads and checkpoints use actual execution signals.
Tool detail contains only bounded query keywords, revision IDs and page numbers; no raw
arguments, results, credentials or model reasoning. Safe failure codes identify the stage.
A completed call is not professional success or a command receipt. A disconnected client
recovers latest-Turn metadata from `session/history` without replaying work. No new OM
capability, endpoint, database migration or mutable history is introduced.

Model text deltas are sent to the connected UI as they arrive, but are not individual
trajectory messages. A successful assistant reply is stored once in
`turn.completed.payload.text`. If a run stops after producing text, the trajectory stores
one `message` with the accumulated `agentTextDelta` and `partial: true`; it is explicitly
incomplete and is not included as a completed conversation turn. The Workbench coalesces
historical delta records by Turn and prefers `turn.completed` for completed Turns. The
append-only JSONL trajectory is not rewritten.

Verified by domain use-case activity assertions, the real ACP history/repeated-ID test,
model initialization failure recovery and the real Pi SDK model-start signal test; CertLab
client/UI tests and the original drawer/material browser scenarios cover presentation.

### Clause precedent lookup

Large clause libraries still resolve only registered on-demand knowledge IDs at a fixed OM
revision. `GitOperatingModel` builds one ID-to-path index per immutable commit and retains
at most four indexes. Movable branch names resolve to their current commit before lookup;
missing and duplicate IDs still fail. Draft worktrees do not use this cache. This avoids
rescanning every knowledge file separately for every declared ID when a Turn starts.
`git-om.test.ts` verifies shared lookups, commit isolation, branch movement and duplicate
rejection. It does not accept source edits into any author's active OM.

### Work 模型终态诊断（2026-10-20）

Work runner 区分 `AgentOutputLimitReached`（模型以 length 停止，包含只有推理或已有部分正文的情况）、`AgentResponseFailed`（error/aborted）和 `AgentReturnedNoText`（未取得最终正文）。length 不能按部分正文报告成功，不自动续跑或重放工具。运维日志 `work.model-response-failed` 只记录 session、provider/model、stopReason、配置输出上限、输入/输出 token 数、内容块类型和是否有正文；不记录私有推理、正文、provider 原始错误或凭据。

真实失败回合 trn_ad3b0f89ee2db32082c1dd37 未记录终态用量，无法回溯判定是 length 还是空 stop。该回合确实加载新版写作约定、第9章导航及9.6.1–9.6.3先例，没有调用业务写命令。真实 SDK 合成本地服务回归见 `apps/api/src/pi-work-agent-response.test.ts`：长度截断有/无正文、空 stop、正常 stop、敏感内容不进入日志、每种响应只请求一次。未以历史报告重放外部模型或修改当前报告。

验证：pnpm build、pnpm check 和 pnpm test 通过（domain 23、workbench 14、API 96）。本次修复只归属模型适配器的终态校验和脱敏运维诊断，未改变 Work/业务权限或自动重试策略；从错误沿 runner→SDK terminal message 可定位，Missing Path / Boundary Bypass / Unowned Capability 均 not-found（high），未发现需另建职责或架构指导的具体风险。

### Verification results and generic work paths

CertLab's catalog now includes `verification.context` and `verification.save-draft`
(`verification.save:{report_id}` receipts). These use the existing accepted catalog,
report-scoped command and receipt recovery protocol. Human recording/withdrawal is
not an Agent capability; verification records are evidence, not a third work-item type.
TestTask can carry a method, conditions, configuration and checkpoint criteria;
Finding can carry clarification purpose, source results and closure verification.
No generic Agent execution/loading behavior changes: the CertLab OM common
`work-paths` document selects the method, and standard/edition chapters reference it.
An OM source edit does not adopt the new snapshot or accept a changed runtime catalog.
