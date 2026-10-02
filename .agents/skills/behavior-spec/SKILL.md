---
name: behavior-spec
description: Use BDD-style behavior specifications to turn product intent into precise, example-driven behavioral contracts before implementation.
---

# Behavior Specification

Use BDD-style behavior specifications to turn product intent into precise, example-driven behavioral contracts before implementation.

The goal is to constrain **what the product does**, while leaving **how the UI realizes it** open to implementation.

## Design Principle

Behavior Spec is the semantic boundary between product intent and UI implementation.

It defines WHAT behavior must hold:
- user intent
- business rules
- state transitions
- observable outcomes

It should not prescribe HOW the behavior is realized through pages, buttons, dialogs, layouts, or other UI mechanisms unless those details are themselves product requirements.

Treat UI/UX as an adapter that realizes the behavior contract.

## Core Principle

Separate three layers:

```text
Domain Model
→ what exists

Behavior Spec
→ what may happen and what must be observable

UI / Implementation
→ how the behavior is presented and implemented
```

The Domain Model is the structural kernel.

The Behavior Spec is the behavioral kernel.

Do not prematurely constrain UI layout, controls, navigation patterns, or visual design unless they are themselves product requirements.

---

## When to Use

Use this skill when:

- implementing a new user-facing workflow;
- changing an existing workflow;
- product requirements contain ambiguity about states, transitions, errors, or edge cases;
- multiple reasonable interaction designs are possible;
- an implementation should later be covered by E2E tests;
- bugs reveal missing or incorrect behavioral assumptions.

Before implementing significant product behavior, first inspect existing behavior specs and update or extend them when necessary.

---

## Behavior Before UI

Describe behavior in terms of:

```text
context
→ user intent / event
→ domain state transition
→ observable outcome
```

Prefer:

```gherkin
Given a report is in Draft state
And all required inspection items are complete

When the user requests report submission

Then the report becomes Pending Review
And further inspection data changes require reopening the report
And the user can observe that the report is awaiting review
```

Avoid:

```gherkin
Given the user is on the report page
When they click the blue Submit button
Then a confirmation modal appears
And they click Confirm
Then the page redirects to /review
```

The second example specifies an implementation.

The first specifies product behavior.

The implementation may use:

- a button;
- command menu;
- keyboard action;
- inline action;
- drawer;
- modal;
- dedicated page;

as long as the specified behavior remains true.

---

## Specify UI Only When It Is Behavior

UI details belong in the specification only when they represent a meaningful product invariant.

Examples:

```text
Destructive operations require explicit confirmation.

Validation errors must be visible before submission can succeed.

The user must be able to compare the proposed report with the previous revision.

A long-running generation operation must expose its current status.

The user must not lose entered data after a recoverable failure.
```

These constrain interaction semantics without unnecessarily fixing presentation.

---

## Examples Are the Primary Design Tool

Do not begin by trying to write abstract rules.

Start from concrete examples.

For every workflow, explore at least:

```text
happy path
boundary case
invalid action
missing information
failure / recovery
different relevant domain states
```

Example:

### Rule

A report can only be submitted after all mandatory inspection items are complete.

### Examples

```text
Example A
Report: Draft
Mandatory items: 12/12 complete
→ submission succeeds

Example B
Report: Draft
Mandatory items: 11/12 complete
→ submission is rejected
→ missing item is identifiable

Example C
Report: Pending Review
Mandatory items: 12/12 complete
→ submission is not available because the report has already been submitted
```

Use examples to discover missing domain rules.

If examples cannot be expressed cleanly, the underlying product model is probably still ambiguous.

---

## From Examples to Scenarios

Promote stable examples into scenarios.

```gherkin
Feature: Submit inspection report

  Rule: All mandatory inspection items must be complete

    Scenario: Submit a complete report
      Given a report is in Draft state
      And every mandatory inspection item is complete

      When the user requests submission

      Then the report becomes Pending Review
      And the submission is recorded

    Scenario: Submit an incomplete report
      Given a report is in Draft state
      And at least one mandatory inspection item is incomplete

      When the user requests submission

      Then the report remains Draft
      And submission is rejected
      And the missing requirements are observable
```

A scenario should normally contain one meaningful behavioral transition.

Do not turn every implementation step into a scenario step.

---

## Use Domain Language

Behavior specs must use terms from the Domain Model.

Prefer:

```text
Report
Inspection Item
Finding
Revision
Review
Submission
```

Avoid accidental UI vocabulary such as:

```text
row
card
tab
dialog
form
screen
button
```

unless those concepts actually belong to the product domain.

If the spec repeatedly needs awkward phrases because the Domain Model lacks a concept, consider updating the Domain Model first.

---

## State Transitions Matter

For workflows, explicitly reason about:

```text
state before
event / intent
state after
side effects
observable result
```

For example:

```text
Draft
  ↓ submit
Pending Review
  ↓ approve
Approved

Pending Review
  ↓ request changes
Draft
```

Ask:

- Is this transition legal?
- Who may trigger it?
- What preconditions apply?
- What information changes?
- What must remain unchanged?
- What does the user observe?
- Can it be retried?
- Can it be reversed?
- What happens when execution fails midway?

Do not leave important state transitions implicit in UI behavior.

---

## Spec → Implementation → E2E

Treat the behavior specification as the source for both implementation and verification.

```text
Product intent
    ↓
Examples
    ↓
Behavior Spec
    ↓
Implementation
    ↓
E2E scenarios
```

The E2E test may translate semantic actions into concrete UI operations.

For example:

Behavior spec:

```gherkin
When the user requests submission
```

E2E implementation:

```text
find current UI affordance for Submit
→ activate it
→ complete confirmation if required
```

The behavior specification therefore remains stable even if the UI later changes from:

```text
button → menu → keyboard shortcut
```

Only the E2E adapter or page abstraction should need to change.

---

## Workflow

When implementing or modifying a product workflow:

### 1. Identify the intent

State what the user is trying to accomplish.

Do not start from screens.

### 2. Identify involved domain concepts

Reuse the existing Domain Model.

Flag missing or ambiguous concepts.

### 3. Explore examples

Generate concrete normal, boundary, invalid, and recovery examples.

Use these examples to discover rules.

### 4. Define rules

Extract stable behavioral rules from the examples.

### 5. Write scenarios

Express important behaviors as Given / When / Then scenarios.

Keep them semantic rather than UI-specific.

### 6. Implement

Choose an appropriate interaction design freely within the constraints imposed by the spec.

### 7. Verify

Use the scenarios as the semantic skeleton for automated E2E tests.

### 8. Refine

If implementation reveals an undefined behavior, update the spec before silently choosing one interpretation.

---

## Agent Rules

When working autonomously:

1. Do not invent important workflow behavior inside implementation code.
2. If behavior is ambiguous, inspect the Domain Model and existing specs.
3. Resolve important ambiguity by adding or refining examples and scenarios.
4. Prefer semantic requirements over UI prescriptions.
5. Do not change existing specified behavior merely because another implementation is easier.
6. UI design may vary freely when all behavioral scenarios remain satisfied.
7. When a bug represents a missing behavioral rule, add a regression example/scenario before or together with the fix.

---

## Definition of Done

A workflow change is complete when:

```text
Domain concepts are clear
+
important behavior is represented by examples
+
state transitions and failure cases are defined
+
behavior spec avoids unnecessary UI coupling
+
implementation satisfies the spec
+
critical scenarios have corresponding E2E coverage
```

The objective is not exhaustive specification.

Specify enough behavior that the Agent's remaining freedom is primarily:

```text
presentation
layout
interaction mechanics
implementation
```

rather than:

```text
product semantics
business rules
workflow meaning
state transitions
```

The specification should reduce product ambiguity without eliminating useful design freedom.
