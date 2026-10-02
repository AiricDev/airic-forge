---
name: clean-architecture-planner
description: Plan non-trivial coding changes in a codebase that already uses Clean Architecture, Hexagonal Architecture, or ports and adapters. Use before implementing features, bug fixes, refactors, business-rule changes, or external integrations that touch entities, use cases, ports, adapters, delivery, persistence, mapping, or architectural boundaries. Acquire sufficient context through existing routes, separate policy from mechanism, locate the owning use case and layer, plan inside-out implementation and level-appropriate tests, and surface unresolved human-owned design decisions. Skip trivial formatting-only, comment-only, mechanical dependency-bump, or generated-only changes.
---

# Clean Architecture Planner

Plan changes inside an architecture the project has already chosen. Do not use this skill to decide whether the project should adopt Clean Architecture. Complete the current task while keeping future modifications cheap to route.

## Mental model

Use this CMP judgment:

> For realistic modifications, prefer the design whose sufficient context is cheaper to acquire.

Treat Clean Architecture as a context-routing system:

1. Separate **policy** (what the system does) from **mechanism** (how it is done).
2. Let a use case own the ordered policy narrative of an application behavior.
3. Let entities own stable invariants independent of flow, storage, UI, and infrastructure.
4. Let the use case author ports in client language; keep provider details behind adapters.
5. Keep source dependencies pointing inward so a well-drawn boundary remains trustworthy.

Classify policy inward: entities, invariants, use cases, application flow, and domain decisions that survive framework, database, vendor, or UI changes. Classify mechanism outward: controllers, UI, HTTP, ORM, SDKs, queues, files, wiring, serialization, and transport DTOs.

## Keep the two routes distinct

- **Discovery route:** Start from the task's natural entry point—such as a failing test, endpoint, domain rule, schema, event, or existing use case. Follow the project's routing signals until the vertical owner, horizontal layer, modification closure, and trustworthy stopping boundaries are clear. Do not impose a fixed layer-reading sequence.
- **Implementation route:** Express policy before mechanism. Establish the relevant invariant and use-case behavior first, let that client define any needed port, then plan adapters, delivery, mapping, wiring, and integration verification outward.

The discovery route may move outside-in. The implementation route stays inside-out. Do not confuse them.

## Authority boundary

Treat a human design gate as an **unresolved what-level decision**, not merely the presence of a new artifact.

Consider a decision resolved when the user request, an approved specification or plan, an existing architectural rule, or an established owner clearly supplies it. Do not ask the user to approve the same decision again.

- **How-level:** Implement within an already-authorized behavior, owner, boundary, contract, or placement rule—for example an adapter, mapper, DTO, controller wiring, repository behind an approved port, focused tests, or restoring use of an existing boundary.
- **What-level:** Decide behavior, use-case boundaries, owned concepts, port semantics, capability ownership, policy placement across modules, dependency direction, shared-policy extraction, or a new placement rule.

When a what-level decision remains unresolved, propose concrete options and stop before implementing that decision. Continue planning or implementing independent how-level work when it is safe to do so.

## Planning modes

- **Quick plan:** Use when intent and ownership are clear, the change is mechanism-only or policy-local, existing boundaries and contracts remain unchanged, and no unresolved gate exists. Return intent, placement, implementation steps, and verification inline.
- **Full plan:** Use when policy, contracts, or boundaries change; the modification closure crosses layers; ownership or placement is unclear; or an unresolved gate may exist. Fill [references/plan-template.md](references/plan-template.md), omitting empty rows and non-decisions.

If unsure, inspect enough context to decide; do not choose full mode merely because the repository is large.

## Planning workflow

1. **Clarify intent and authority.** State the behavior to change, behavior to preserve, success criteria, explicit decisions already made, and genuine product or domain ambiguities. Make reasonable implementation assumptions; do not guess unresolved product policy.
2. **Start from the natural entry point.** Read the repository's existing routing guidance, including architecture-map.md when present, then follow the strongest local signals: names, imports, types, tests, registries, contracts, and ownership notes.
3. **Acquire sufficient context.** Inspect the artifacts needed to identify the owner, layer, closure, boundary contracts, and verification surface. Stop at a trustworthy boundary. Record why excluded regions do not belong to this modification. Broaden search only when the intended route is missing or misleading, and report that routing gap.
4. **Locate the change in CA coordinates.** Assign a vertical owner (use case or business process) and a horizontal layer (entity, use case, port, adapter, delivery, persistence, mapper, or test). No clear vertical owner means ownership-needed; an unclear layer means placement-review.
5. **Classify each concern.** Use entity-invariant, use-case-policy, port-contract, adapter-mechanism, delivery-mechanism, persistence-mechanism, mapping-dto-serialization, test-verification, ownership-placement, or architecture-boundary. State whether it is policy, mechanism, boundary, or placement.
6. **Confirm the modification closure.** List every artifact that must change, be checked, or remain consistent. Inspect enough context to make the implementation plan concrete; return inspect more context first instead of presenting a speculative plan when the closure is still unknown.
7. **Check boundary trust.** Ask whether each relevant contract is use-case-shaped, makes required behavior, failures, and side effects clear, and preserves inward dependencies. Use trusted, verify, or untrusted. Restore an established route or dependency as how-level work; treat changed semantics or a redrawn boundary as a human gate.
8. **Plan ports and adapters.** Reuse a fitting port. If a port must change or be created, describe the capability in use-case language without copying provider types, then determine whether its semantics are already authorized. Keep SDK, ORM, HTTP, persistence, and transport types out of inner layers.
9. **Surface unresolved design gates.** Report only gates that remain unresolved after considering the request, approved decisions, and existing architecture. Do not generate a table of every possible gate.
10. **Produce an inside-out implementation route.** Pair tests with the layer whose behavior they express. Plan entity invariants and use-case policy before client-authored ports, then adapters, delivery, mapping, and wiring. Drop layers with no real change.
11. **Plan verification at the owning level.** Use entity tests for invariants; use-case tests with fake ports for policy; contract tests for ports; integration tests for adapters; controller, repository, or mapper tests for delivery and persistence mapping; and lint or architecture tests for dependency direction. Use E2E as cross-system confidence, not the only policy oracle.
12. **Plan routing-index maintenance.** If implementation will create or move an approved structural route, include a later architecture-map.md update. Do not create or edit the map merely to produce the plan.

## Architecture map

Treat an existing root architecture-map.md as a routing index, not a mirror of the code.

- Read only the task-relevant entries during planning, then verify them against the code you already need to inspect.
- If the map is missing, continue through the repository's other routing signals and report the missing index. Do not scan the whole repository or bootstrap a map as incidental planning work.
- If an entry is stale, report the discrepancy. Include its correction in authorized implementation only when the structural fact is settled.
- If the user explicitly authorizes a separate bootstrap task, use [references/architecture-map-template.md](references/architecture-map-template.md).
- Record approved structural decisions; never let a map entry make a new use case, port, owner, boundary, or convention by implication.

## Final check

Before returning the plan, verify:

1. Intent, preserved behavior, and settled design authority are explicit.
2. The context came from a natural entry point and stopped at trustworthy boundaries.
3. The vertical owner, horizontal layer, and modification closure are evidence-backed.
4. Policy and mechanism are separated.
5. Port contracts are client-authored and provider types stay outward.
6. Only unresolved what-level decisions are gated.
7. The implementation route is inside-out and tests sit at the owning level.
8. Any architecture-map change is a later authorized implementation step, not a planning side effect.
