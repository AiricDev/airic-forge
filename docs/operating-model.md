# Operating Model and Context Compilation

**Status:** Proposed  
**Scope:** `@airic/framework` Operating Model representation, document management, context routing, context compilation, and reflective evolution

## 1. Purpose

Airic needs a durable body of knowledge that allows an Agent to perform domain work reliably.

This knowledge has two fundamental categories:

- knowledge about the domain in which the Agent works;
- knowledge about how a particular kind of work should be performed.

Airic models these as **Subject Knowledge (SK)** and **Work Definitions (WD)**. Together they form an **Operating Model (OM)**.

A Work Definition is the runtime entry point into the Operating Model. It identifies the knowledge and working guidance needed for a kind of Work. Subject Knowledge provides reusable domain understanding that may be shared by many Work Definitions.

The Context Compiler resolves this structure into the minimum sufficient context for a concrete Work.

The design separates durable organizational knowledge from:

- authoritative Business State owned by the business application;
- transient execution state owned by the Agent harness;
- Work trace and evidence produced during execution.

---

# 2. Core Model

```text
                   Operating Model
                         │
              ┌──────────┴──────────┐
              │                     │
              SK                    WD
       know the domain        know the work
              │                     │
              │               routing root
              └──────────┬──────────┘
                         │
                         ▼
                  Context Compiler
                         │
             + Current Business State
             + Evidence
             + Work State
                         │
                         ▼
                  Context Envelope
                         │
                         ▼
                   Agent Harness
```

Operationally:

> An Operating Model contains the durable knowledge required for reliable work. SK captures reusable understanding of the domain. WD captures reusable understanding of how a kind of work should be performed and acts as the context-routing entry point.

---

# 3. Design Principles

## 3.1 Operating Model is durable operational knowledge

An Operating Model contains knowledge expected to improve future work.

It does not contain:

- current business records;
- transient task state;
- model sessions or conversation history;
- arbitrary execution traces;
- temporary hypotheses;
- secrets or credentials.

Experience enters the Operating Model only through explicit Reflection, attribution, review, and adoption.

## 3.2 SK describes the domain; WD describes the work

The primary distinction is:

> **Subject Knowledge describes what the Agent needs to know about the domain.**

> **Work Definition describes what the Agent needs to know to perform a kind of work.**

For example:

```text
"A ReportType determines the structure of a Report."
→ SK

"Before authoring a Report, inspect its ReportType."
→ WD
```

SK and WD are document categories, not runtime domain entities.

Airic does not require framework-level entities for concepts such as Report, Evidence, Product, Architecture, or Customer.

## 3.3 WD is the context-routing entry point

A Work does not begin by searching the entire Operating Model.

It resolves a WD first:

```text
Work
  ↓
Work Definition
  ↓
Context Routing
  ├── bootstrap SK
  ├── conditional SK
  └── dynamically discovered SK
  ↓
Context Compilation
  ↓
Agent Harness
```

## 3.4 Context is compiled, not accumulated

The purpose of context assembly is not to expose all available knowledge.

It is to compile the **minimum sufficient execution context** for the current Work and current execution stage.

Large OM packages remain outside model context by default.

## 3.5 Documents remain documents

SK and WD are primarily natural-language documents.

The schema exists only for information the framework must interpret deterministically:

- identity;
- document type;
- routing;
- dependencies;
- summaries;
- lifecycle metadata.

Domain knowledge and work guidance remain in Markdown rather than being forced into a universal structured ontology.

---

# 4. Operating Model Package

An Operating Model package is the versioned knowledge boundary for a coherent domain of work.

```text
Operating Model Package
│
├── Subject Knowledge
│   └── reusable domain knowledge
│
└── Work Definitions
    └── reusable knowledge for performing kinds of work
```

Example:

```text
certification-reporting/
│
├── sk/
│   ├── certification-concepts.md
│   ├── report-model.md
│   ├── report-type.md
│   ├── evidence.md
│   └── review-rules.md
│
└── work-types/
    ├── report-authoring/
    │   └── definition.md
    ├── report-type-defining/
    │   └── definition.md
    └── report-review/
        └── definition.md
```

The filesystem layout is an adapter concern.

The semantic contract is that an OM revision exposes:

```text
OperatingModelRevision
├── SubjectKnowledgeResource[]
└── WorkDefinition[]
```

The entire revision is immutable.

---

# 5. Common Document Schema

All OM documents share a minimal metadata envelope.

Markdown with YAML front matter is the reference representation:

```yaml
---
id: report-type
kind: subject-knowledge
title: Report Type

summary: >
  Defines how ReportType controls report structure,
  required information and validation semantics.

topics:
  - report
  - report-type
  - validation

related:
  - sk:report-model
  - sk:evidence
---
```

followed by normal Markdown content.

## 5.1 Required fields

### `id`

Stable identity within the OM package.

```yaml
id: report-type
```

IDs survive file moves and title changes.

Context references use IDs rather than filesystem paths.

### `kind`

Framework-level document category.

Initially:

```text
subject-knowledge
work-definition
```

The first version should deliberately keep this vocabulary small.

### `title`

Human-readable title.

### `summary`

A compact semantic description used by the routing surface.

The summary should answer:

> What knowledge will I gain by loading this resource?

It should not attempt to reproduce the document.

## 5.2 Optional common fields

### `topics`

Lightweight search and routing hints.

```yaml
topics:
  - evidence
  - provenance
  - report
```

Topics are hints, not a controlled domain ontology.

### `related`

Explicit semantic relationships.

```yaml
related:
  - sk:report-model
  - sk:evidence
```

Relationships improve navigation but do not imply automatic loading.

### `status`

Optional lifecycle state:

```yaml
status: active
```

Possible values may include:

```text
active
deprecated
```

Historical versions do not need document-level status because OM revisions already provide immutable history.

---

# 6. Subject Knowledge Schema

SK uses the common document schema without introducing a domain meta-model.

Example:

```yaml
---
id: evidence
kind: subject-knowledge
title: Certification Evidence

summary: >
  Explains evidence categories, provenance rules,
  interpretation constraints and their relationship
  to report claims.

topics:
  - evidence
  - provenance
  - report

related:
  - sk:report-model
---
```

The body contains the actual domain knowledge:

```markdown
# Certification Evidence

Evidence supports factual claims made in a certification report.

## Evidence categories

...

## Provenance

...

## Interpretation constraints

...
```

Airic does not parse headings such as `Evidence categories` into framework entities.

They are knowledge for the Agent.

## 6.1 SK granularity

An SK document should represent a coherent unit that can reasonably be routed independently.

The design must avoid both extremes:

```text
one giant domain manual
→ cheap discovery, expensive loading

one fact per document
→ cheap loading, expensive discovery
```

The desired boundary is **reasoning locality**:

> Knowledge commonly needed together should usually live together.

## 6.2 SK relationships

Explicit references are useful when knowledge has strong semantic dependencies:

```yaml
related:
  - sk:report-model
```

But `related` does not mean:

```text
load recursively
```

Recursive dependency expansion would quickly recreate the problem Context Compilation is intended to solve.

Relationships expand the routing surface; the compiler decides what to load.

---

# 7. Work Definition Schema

WD has additional routing semantics because it is the entry point for a Work.

Example:

```yaml
---
id: report-authoring
kind: work-definition
title: Report Authoring

summary: >
  Guides an Agent in completing and revising a certification
  report from available business state and evidence.

topics:
  - report
  - authoring

context:
  bootstrap:
    - sk:report-model
    - sk:report-type

  available:
    - sk:evidence
    - sk:review-rules
---
```

The body defines the work itself:

```markdown
# Report Authoring

## Goal

Produce a complete and evidence-grounded draft report.

## Boundaries

Do not publish, approve or export the report.

## Working method

...

## Verification

...

## Recovery

...
```

The framework interprets the front matter.

The Agent interprets the Markdown body.

---

# 8. WD Context Declaration

The `context` section defines the WD's initial routing surface.

The initial design should keep only two explicit classes:

```yaml
context:
  bootstrap:
    - sk:report-model

  available:
    - sk:evidence
    - sk:review-rules
```

## 8.1 `bootstrap`

Knowledge expected to be required for almost every execution of this WD.

The compiler loads it into the initial Context Envelope.

Use this category conservatively.

Every bootstrap dependency has a recurring context cost.

## 8.2 `available`

Knowledge known to be potentially relevant but not normally required at startup.

Its metadata becomes part of the routing surface.

Its body is loaded only when needed.

This distinction expresses:

```text
bootstrap
→ load now

available
→ know that it exists
```

It deliberately avoids more elaborate categories such as `optional`, `recommended`, `conditional`, `lazy`, or `required-at-stage`.

Those distinctions can be introduced later only if concrete routing requirements justify them.

---

# 9. Referencing Resources

OM references use semantic resource IDs:

```text
sk:report-model
sk:evidence
wd:report-authoring
```

The filesystem location is not part of the semantic identity.

The repository adapter resolves:

```text
ResourceRef
→ document
```

This permits:

- file reorganization;
- alternate repository adapters;
- generated indexes;
- future package composition.

A reference always resolves against the OM revision pinned to the current execution boundary.

---

# 10. Work Definition Body

The WD body is intentionally less structured than its routing metadata.

Common sections are recommended:

```text
Goal
Boundaries
Inputs
Working Method
Decision Criteria
Verification
Recovery
Escalation
```

But these headings should initially remain conventions rather than framework schema.

Different kinds of work may need different structures.

For example:

```text
report-authoring
→ evidence handling and completeness

incident-response
→ containment and recovery

research
→ hypothesis and evidence evaluation

software-feature-development
→ behavior, implementation and verification
```

Forcing them into one rigid machine schema would encode accidental assumptions about work.

The framework needs to know **which WD governs the Work and how to route its knowledge**, not how every work procedure must be represented internally.

---

# 11. Routing Surface

The complete body of the OM is not exposed merely so that the Agent can discover available knowledge.

Airic derives a compact routing surface from metadata.

For SK:

```text
id
title
summary
topics
related
```

For WD:

```text
id
title
summary
topics
context references
```

Example runtime representation:

```json
{
  "ref": "sk:evidence",
  "title": "Certification Evidence",
  "summary": "Evidence categories, provenance rules and interpretation constraints.",
  "topics": ["evidence", "provenance", "report"]
}
```

The routing surface is therefore much smaller than the documents it indexes.

---

# 12. Context Compiler

The Context Compiler transforms durable OM knowledge plus current runtime inputs into an execution context.

Conceptually:

```text
compile(
    work,
    activeOperatingModelRevision,
    currentBusinessState,
    availableEvidence
) -> ContextEnvelope
```

Compilation may be incremental.

## 12.1 Stage 1 — Pin OM revision

Resolve the active OM revision.

All resource resolution during the execution boundary uses this immutable snapshot.

## 12.2 Stage 2 — Resolve WD

Resolve the Work's WD:

```text
Work.workType
→ wd:<id>
```

The WD becomes the root of OM context routing.

## 12.3 Stage 3 — Compile bootstrap context

Load:

```text
WD body
+
WD.context.bootstrap SK
+
Work identity / scope
+
authoritative current-state projection
+
relevant existing evidence
```

This becomes the initial Context Envelope.

## 12.4 Stage 4 — Build routing surface

Expose metadata for:

```text
WD.context.available
+
resources reachable through explicit relationships
+
resources discoverable through OM search
```

Full document bodies remain unloaded.

## 12.5 Stage 5 — Dynamic routing

During execution, additional knowledge can be selected based on:

- current Work state;
- current business state;
- concepts encountered in evidence;
- Agent questions;
- WD routing surface;
- SK relationships;
- OM search.

## 12.6 Stage 6 — Load selected resources

When a resource is selected, its content is loaded with provenance:

```text
resource ID
OM revision
routing reason
source document
```

This makes context assembly observable and attributable.

---

# 13. Deterministic and Semantic Routing

Context routing should use deterministic information first.

## 13.1 Deterministic routing

Examples:

```text
Work Type
→ exact WD

WD.bootstrap
→ exact SK

explicit SK reference
→ exact resource

resource relationship
→ known routing candidate
```

These operations are cheap and reproducible.

## 13.2 Semantic routing

LLM or semantic retrieval is appropriate when the required knowledge cannot be identified structurally.

Examples:

```text
Which SK resource explains this unfamiliar concept?

Which existing knowledge is relevant to this unexpected evidence?

Does the current problem require knowledge outside the normal WD surface?
```

The architecture is:

```text
Work
 ↓
WD
 ↓
Deterministic routing
 ↓
Narrow routing surface
 ↓
Semantic selection / search
 ↓
Selected resources
```

Search is therefore a mechanism **inside** context routing, not the architecture of context routing.

---

# 14. Knowledge Access Interface

Initial compilation cannot predict every piece of knowledge needed during long-running work.

The harness therefore needs a narrow OM knowledge interface.

Conceptually:

```text
list_context_resources()
search_knowledge(query)
load_resource(ref)
```

The exact tool API is adapter-specific.

All operations use the pinned OM revision.

## 14.1 `list_context_resources`

Returns the WD-derived routing surface.

This is the preferred discovery mechanism.

## 14.2 `search_knowledge`

Searches the wider OM when the normal WD routing surface is insufficient.

Search results return metadata first:

```text
ref
title
summary
topics
```

rather than automatically injecting document bodies.

## 14.3 `load_resource`

Loads an exact resource.

The returned content retains resource identity and revision provenance.

---

# 15. Context Envelope

The Context Envelope is the boundary between Airic's Context Compiler and the Agent harness.

Conceptually:

```text
ContextEnvelope
│
├── Work
│   ├── identity
│   ├── goal
│   └── scope
│
├── Work Definition
│
├── Subject Knowledge
│   └── loaded SK resources
│
├── Routing Surface
│   └── available unloaded resources
│
├── Current State
│   └── authoritative Cognitive Interface projection
│
├── Evidence
│
└── Provenance
    ├── OM revision
    ├── loaded resource IDs
    └── routing reasons
```

The harness may serialize this structure into provider-specific model context.

The framework-level representation preserves source boundaries.

---

# 16. Context Budget and Loading Policy

The compiler should distinguish three states for an OM resource:

```text
unknown
known but unloaded
loaded
```

The desired default is:

```text
most OM resources
→ known or unknown

small routing surface
→ known but unloaded

minimum sufficient subset
→ loaded
```

This prevents a growing OM from producing a proportionally growing prompt.

When context pressure requires eviction or compaction, the harness owns the runtime mechanism.

Airic retains resource identity so that evicted knowledge can be loaded again from the pinned OM revision.

---

# 17. Reflection and OM Evolution

Execution does not directly modify the OM.

Reflection analyzes:

- Work trace;
- evidence;
- outcomes;
- rejections;
- conflicts;
- human corrections.

It may then propose reusable knowledge.

The primary attribution decision is:

```text
What did we learn?

        ┌───────────────────────────┐
        │                           │
about the domain?            about doing the work?
        │                           │
        ▼                           ▼
     SK patch                    WD patch
```

## 17.1 SK attribution

A finding belongs to SK when it improves reusable understanding of the domain.

Example:

> A certification metric represents maximum validated operating range rather than nominal operating range.

## 17.2 WD attribution

A finding belongs to WD when it improves how a kind of work should be performed.

Example:

> When this metric is absent from the primary evidence, inspect the validation appendix before requesting more information.

## 17.3 Promotion rule

A finding should remain trace/evidence when it is:

- specific only to the current Work;
- temporary or speculative;
- insufficiently validated;
- current Business State;
- harness World State.

A useful promotion test is:

```text
Will this improve future work?
          │
      ┌───┴───┐
      no      yes
      │        │
 trace only    ▼
         knowledge about domain?
             │
            SK

         knowledge about work?
             │
            WD
```

If neither attribution is defensible, the finding does not enter the OM.

---

# 18. Reflection Patch Schema

Reflection proposals should identify changes semantically rather than editing arbitrary repository paths.

Conceptually:

```yaml
proposal:
  based_on_revision: abc123

  changes:
    - operation: update
      resource: sk:evidence
      rationale: >
        Work evidence showed that the previous description
        conflated nominal and validated operating ranges.
      evidence:
        - work:123
        - trace:event-456

    - operation: update
      resource: wd:report-authoring
      rationale: >
        Repeated author corrections show that the validation
        appendix should be checked before requesting new evidence.
      evidence:
        - work:123
        - work:127
```

The actual content change may still be represented as a document patch.

The important framework-level information is:

```text
what resource changed
what kind of knowledge changed
why
based on what evidence
against which OM revision
```

SK and WD changes remain separately attributable even when adopted atomically.

---

# 19. Governance and Versioning

The Operating Model remains an immutable, versioned package.

A revision contains a coherent snapshot of:

```text
SK + WD
```

The lifecycle remains:

```text
Active OM Revision
        │
        │ execution evidence
        ▼
    Reflection
        │
        ▼
  Proposed OM Patch
   ├── SK changes
   └── WD changes
        │
        ▼
      Review
        │
        ▼
      Adopt
        │
        ▼
New Active OM Revision
```

Runtime never edits the active revision.

Reflection never adopts its own proposal.

---

# 20. Validation

OM documents should be validated before a revision can become active.

Structural validation includes:

```text
unique resource IDs
recognized kind
required metadata present
valid resource references
WD bootstrap references resolve to SK
WD available references resolve to SK
no malformed front matter
```

Validation should not attempt to determine whether natural-language knowledge is semantically correct.

That remains a review and governance responsibility.

Warnings may be generated for:

```text
unreferenced SK
deprecated references
very large bootstrap context
missing summaries
broken related links
```

These are quality signals rather than necessarily activation blockers.

---

# 21. Package Composition

The first implementation should assume one coherent OM package per deployed domain.

Future composition may allow:

```text
domain OM
   │
   ├── imports shared OM
   └── local SK + WD
```

For example:

```text
certreporter-development
       │
       └── imports software-engineering
```

Cross-package identity could later extend resource refs:

```text
software-engineering/sk:domain-modeling
```

Package composition is intentionally deferred until concrete reuse requirements exist.

The initial design should avoid inheritance, override semantics, dependency resolution and conflict precedence.

---

# 22. Repository Evolution

The current repository model evolves from:

```text
project/
└── work-types/
```

to:

```text
project/
├── sk/
│   └── *.md
│
└── work-types/
    └── <id>/
        └── definition.md
```

Existing Work Definitions remain valid OM resources.

The migration introduces:

1. SK as a second document category;
2. common document metadata;
3. WD context declarations;
4. resource-based context routing;
5. provenance-aware context loading.

No change is required to the fundamental Work/Action runtime boundary.

---

# 23. Framework Contracts

`@airic/framework` should own semantic contracts equivalent to:

```text
OperatingModelRevision

OperatingModelResource
├── SubjectKnowledgeResource
└── WorkDefinition

ResourceRef
RoutingSurface
ContextEnvelope

OperatingModelRuntimePort
OperatingModelLearningPort
OperatingModelGovernancePort
```

The framework owns:

- resource identity;
- resource type;
- revision consistency;
- WD resolution;
- routing metadata;
- resource references;
- context provenance;
- Reflection attribution;
- proposal semantics.

The framework does **not** own:

- domain concepts described inside SK;
- a universal work-process ontology;
- harness sessions;
- model context-window management;
- Business State;
- business authorization.

---

# 24. Non-Goals

This design does not attempt to:

- define a universal ontology for business domains;
- model domain concepts as Airic entities;
- turn SK into a knowledge graph schema;
- turn WD into a universal workflow language;
- replace the business application's domain model;
- persist harness World State into the OM;
- automatically convert trace findings into memory;
- load the entire OM before execution;
- make filesystem layout part of the public contract;
- solve package dependency management in the first implementation.

---

# 25. Resulting Architecture

The resulting document architecture is:

```text
                   OM Package
                       │
          ┌────────────┴────────────┐
          │                         │
         SK                        WD
   domain knowledge          work knowledge
          │                         │
          │                  context entry point
          │                         │
          └────────────┬────────────┘
                       ▼
                Routing Surface
                       │
                       ▼
                Context Compiler
                       │
          ┌────────────┼─────────────┐
          │            │             │
      OM Context   Business State   Evidence
          │            │             │
          └────────────┼─────────────┘
                       ▼
                Context Envelope
                       │
                       ▼
                  Agent Harness
```

The document schema supports this architecture without making Airic understand the domain itself:

```text
Document body
→ knowledge interpreted by Agent

Document metadata
→ structure interpreted by Airic
```

The essential runtime path is:

```text
Work
→ WD
→ bootstrap SK
→ routing surface
→ initial context

        ↓ execution

need more knowledge
→ deterministic narrowing
→ semantic search if necessary
→ load exact SK
→ continue

        ↓ completion

trace + evidence
→ Reflection
→ SK / WD attribution
→ OM proposal
→ review
→ adoption
→ new immutable OM revision
```

This makes the Operating Model both scalable and evolvable:

> **WD gives each kind of Work a stable entry point into the Operating Model; SK provides reusable domain understanding; document metadata forms the routing surface; the Context Compiler loads only the knowledge required by the current Work; Reflection feeds validated experience back into SK and WD as separately attributable changes.**
