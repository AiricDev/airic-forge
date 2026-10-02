# Architecture Map

Use this template only for an explicitly authorized architecture-map bootstrap task. The planner reads an existing root architecture-map.md; it does not create or fill one as a planning side effect.

Keep the map a stable routing index, not a mirror of implementation detail.

- Last updated:
- Architectural decision owners:

## Layer layout

| Layer | Location | Notes |
|---|---|---|
| Entities / domain |  |  |
| Use cases / application |  |  |
| Ports |  |  |
| Adapters / infrastructure |  |  |
| Delivery |  |  |
| Persistence |  |  |
| Tests |  |  |

## Use case catalog

| Use case | Purpose | Location | Ports used | Key entities |
|---|---|---|---|---|
|  |  |  |  |  |

## Ports and adapters

| Port | Capability in client language | Location | Adapters | Contract test |
|---|---|---|---|---|
|  |  |  |  |  |

## Core entities and invariants

| Entity or value object | Owned invariant | Location |
|---|---|---|
|  |  |  |

## Conventions and placement rules

- New use case:
- New port:
- New adapter:
- Naming:
- Dependency-rule enforcement:
- Other:

## Known boundary debts

| Boundary | Problem | Risk | Owner / status |
|---|---|---|---|
|  |  |  |  |

## Open ownership questions

| Capability | Candidate owners | Decision needed |
|---|---|---|
|  |  |  |

## Maintenance rules

- Record only approved, durable structural facts that make future navigation cheaper.
- Verify task-relevant entries against code before relying on them.
- Update the map after authorized implementation creates, moves, or resolves a route.
- Report an unresolved owner or boundary; do not settle it through documentation.
- Remove entries that merely duplicate obvious code or are too detailed to remain stable.
