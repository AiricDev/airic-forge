# Full Plan Template

Keep the plan decision-focused. Omit empty rows and sections that add no information.

## 1. Intent and authority

- Intended behavior change:
- Behavior to preserve:
- Success criteria:
- Settled product or design decisions:
- Genuine ambiguities:

## 2. Context route and modification closure

- Natural entry point:
- Routing signals followed:
- Sufficient context acquired:
- Trustworthy stopping boundaries:
- Intentionally excluded regions and why:
- Routing gaps found:

| Artifact | Role | Change or verify | Why it belongs to the closure |
|---|---|---|---|
|  | primary / sibling / downstream / verification |  |  |

## 3. Policy and mechanism placement

| Concern | Classification | Vertical owner | Horizontal layer | Policy / mechanism / boundary / placement | Evidence |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

Classification: entity-invariant, use-case-policy, port-contract, adapter-mechanism, delivery-mechanism, persistence-mechanism, mapping-dto-serialization, test-verification, ownership-placement, or architecture-boundary.

Use ownership-needed when no vertical owner is established and placement-review when the layer is unresolved.

## 4. Boundaries and human decisions

| Boundary or capability | Trust | Existing contract or owner | Planned action | Authority |
|---|---|---|---|---|
|  | trusted / verify / untrusted |  |  | how-level / resolved what-level / unresolved what-level |

Unresolved human design gates only:

- Decision:
- Options and trade-offs:
- Safe work that can continue independently:

Write None when no unresolved gate exists.

## 5. Inside-out implementation and verification

Pair tests with the behavior they own. Use only the applicable steps:

1. Specify or test the relevant invariant or use-case behavior.
2. Implement entity invariant changes.
3. Implement the use-case policy narrative.
4. Define or adjust the client-authored port.
5. Implement adapter mechanism and contract/integration tests.
6. Implement delivery, mapping, persistence, and wiring changes.
7. Run focused tests, dependency checks, and necessary E2E coverage.

- Concrete implementation steps:
- Tests and checks:
- Manual review focus on policy or contract decisions:
- Later architecture-map.md update, if an approved route changes:
- Agent may implement:
- Agent must not decide without approval:
- Next step: proceed / resolve gate / inspect more context
