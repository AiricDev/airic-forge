# Reflection principles

## Scope

Audit changeability and architecture conformance: discoverability, boundary trust, and ownership predictability. Do not present this audit as validation of product correctness, domain completeness, or all quality attributes.

## Evidence before judgment

- Treat the current task context as the primary evidence source. The agent's just-experienced route is already observable and does not require separate logging or reconstruction.
- Do not default to reading a diff, logs, or history. Use artifacts and tools only to verify a specific uncertain fact or compensate for an explicitly missing part of the live trace.
- Summarize the route facts relevant to design; do not emit a full reasoning transcript.
- Separate observed trace facts from inference.
- Tie every `found` result to a concrete artifact and a future failure scenario.
- Use `unknown` when evidence is incomplete.
- Prefer no finding over a generic or speculative finding.
- Treat passing tests as behavior evidence, not proof that placement and boundaries are correct.

## Authority before repair

Default to report mode. A reflection request authorizes inspection and recommendations, not writes. Enter repair mode only when the user explicitly asks to apply findings.

Classify proposed action as:

- **How-level** — implementation inside an already-authorized behavior, owner, boundary, or placement convention. Examples: correct a pointer, improve a focused test, route through an existing port, remove duplication in favor of an existing owner.
- **What-level** — a decision that creates or changes behavior, ownership, a boundary, a layer, dependency direction, or a shared abstraction. Report the decision and request authority.

How-level describes design authority, not automatic permission to edit. Writes still require task authorization.

## Anti-overreach

Do not:

- invent a missing trace;
- treat every wide search or duplicate as a design defect;
- create a shared abstraction because reuse seems possible;
- silently decide ownership or placement;
- redesign architecture after a local task;
- hide a what-level decision inside a small patch;
- update `AGENTS.md`, architecture maps, or skills as implicit self-learning.

## Controlled learning loop

Reflection may identify improvements to existing guidance surfaces. Recommend such changes only when the task provides concrete evidence that the current guidance caused or failed to prevent a routing problem.

Prefer this progression:

1. Record the task-local signal.
2. Look for recurrence or strong omission risk.
3. Propose the smallest update to an existing guidance owner.
4. Obtain authorization.
5. Apply and forward-test the guidance change independently.

This enables skill and repository evolution without turning reflection into uncontrolled self-modification.

## Quality bar

A good reflection is concise, evidence-backed, explicit about uncertainty, useful to the next modifier, and comfortable reporting no issue. A bad reflection re-summarizes the implementation, produces generic architecture advice, or recommends a new abstraction without ownership analysis.
