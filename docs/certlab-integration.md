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
| Work | Explicit goal and report scope; new Work and resume-by-ID are distinct; different goals for one report do not merge |
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
material ranges and uses bounded Pi SDK summaries. The authoritative trajectory is never rewritten.
The defaults are 32000 input / 8000 output tokens, with 10% model-window headroom and organization at 80%.
Configure `FORGE_CONTEXT_INPUT_TOKENS` / `FORGE_CONTEXT_OUTPUT_TOKENS` when needed.
A failed summary or oversized mandatory context pauses further calls; committed App effects remain committed.
`asset.read` / `asset.read-location` default to 4000 Unicode code points (max 8000); pixels require
`include_image=true`. Persist the fixed `source.text_range`, not tool bodies. Current receipt requests use
`target_kind` / `target_id`, never the removed `assessment_id` transport field.
See CertLab `docs/context-budget.md` for the cross-repository contract and test mapping.
