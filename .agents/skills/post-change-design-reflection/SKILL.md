---
name: post-change-design-reflection
description: Reflect directly on the agent's live task context after a completed non-trivial code change to detect context-routing gaps, unauthorized boundary shortcuts, and unclear capability ownership. Use immediately after the work while its searches, discoveries, dead ends, placement decisions, and verification remain in context, when the user requests a post-task design reflection or architecture retrospective, or after a change crosses layers, modifies shared behavior, or reveals uncertain placement. Do not use for routine summaries, formatting-only edits, generated-only changes, or ordinary test reporting.
---

# Post-change Design Reflection

Inspect how a completed change affected the codebase's future changeability. Observe the route used to find and place the change directly from the current task context, then identify evidence-backed design signals that could make the next modification harder.

The goal is to lower future context cost by keeping modification closures discoverable, boundaries trustworthy, and capabilities predictably owned. This is an architecture-maintainability audit, not proof that the product model or overall architecture is correct.

## Primary observation rule

The live task context is the primary observation surface. The searches, files opened, signals followed, dead ends, corrections, boundary decisions, placement uncertainty, and verification just experienced are already available as evidence. Observe them directly; no extra logging or evidence-collection pass is required.

- Do not begin by reading logs, inspecting history, rerunning searches, or reconstructing the process from the diff.
- Use the diff, final code, tests, or a focused tool call only to verify a specific uncertain fact. They describe or corroborate the result; they do not replace the route that produced it.
- Summarize relevant route events and decisions. Do not dump the entire reasoning stream or produce a chronological task transcript.
- If compaction, handoff, a new agent, or unavailable history removed part of the live trace, identify that gap and mark affected conclusions `unknown`. Do not manufacture a route from artifacts alone.

## Operating modes

- **Report mode is the default.** Inspect and recommend; do not edit files merely because a repair is how-level.
- **Repair mode requires explicit user authorization.** Apply only the approved how-level repairs, then verify them proportionately.
- Never introduce a new concept, owner, boundary, layer, or placement rule without explicit authorization.

## Evidence contract

For every check, report:

- `result`: `found`, `not-found`, or `unknown`.
- `evidence`: concrete events already observed in the live task trace, optionally corroborated by files, tests, errors, imports, or a diff.
- `future-risk`: a plausible way a later modifier could omit, bypass, or duplicate behavior.
- `confidence`: `high`, `medium`, or `low`.
- `level`: `how-level` or `what-level` when action is proposed.

A route event present in the current context is direct evidence; it does not need an external log or a second tool call to prove that it happened. Distinguish observed evidence from inference. If the trace is incomplete because of context compaction, handoff, subagents, or unavailable history, mark affected checks `unknown`; do not invent a complete route. Wide search, many changed files, or passing tests alone do not fire a check.

## Workflow

1. **Observe the live route before collecting anything.** Read the task context already in memory: the natural entry point, signals followed, useful and misleading paths, corrections, boundary choices, placement decisions, and verification.
2. **Establish trace coverage.** State which parts of that live route remain available and label only material gaps. Perform a focused fact check only when a specific uncertainty would change the conclusion.
3. **Identify the modification closure.** List the artifacts that had to change together and the route a future modifier is expected to follow.
4. **Run all three checks.** Evaluate Missing Path, Boundary Bypass, and Unowned Capability using [references/checks.md](references/checks.md). Apply the evidence threshold before returning `found`.
5. **Analyze ownership and authority.** If ownership is unclear, report possible owners and the decision needed; do not choose silently.
6. **Recommend the smallest response.** Classify it with [references/principles.md](references/principles.md). Prefer an existing destination, boundary, or convention.
7. **Produce the report.** Use [references/report-template.md](references/report-template.md). Keep it concise; one precise signal is better than generic advice.
8. **Apply only when authorized.** In repair mode, implement approved how-level changes, rerun relevant checks, and report what changed.
9. **Feed learning forward.** When evidence shows a repeated routing failure, propose an update to an existing architecture map, `AGENTS.md`, test convention, or skill. Treat changes to these guidance surfaces as separate writes requiring authorization; never silently self-modify.

## The three checks

- **Missing Path** — required context or sibling changes were unnecessarily hard to discover, creating omission or reinvention risk.
- **Boundary Bypass** — the change crossed or weakened an established service, adapter, repository, validator, policy, state machine, API, or layer boundary.
- **Unowned Capability** — new or duplicated behavior has no predictable architectural home and needs an ownership decision.

## Non-goals

Do not use this reflection to claim that:

- the domain model or product behavior is inherently correct;
- the current architecture is optimal merely because its boundaries were followed;
- security, performance, concurrency, operability, or usability were reviewed unless evidence for those concerns was explicitly inspected;
- every broad modification closure is a locality failure.

## Final check

Before finishing, verify that all three checks have explicit results, every `found` result has concrete evidence and a future-risk scenario, uncertainty is visible, recommendations respect write authority, and the report explicitly says when no actionable routing issue was found.
