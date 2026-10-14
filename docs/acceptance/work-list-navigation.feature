Feature: Paginated Work list and dedicated Work detail

  Scenario: Browse many Works
    Given a user owns more than 20 Works
    And no Work changes while the user moves between pages
    When the user opens the Work list
    Then only the first 20 Works are returned, newest update first
    And the list shows the current page and total page count
    When the user opens the next page
    Then the next 20 Works are shown without repeating a Work from the first page

  Scenario: Open a Work from the list
    Given a user can read a Work on the current page
    When the user opens that Work
    Then a dedicated Work URL shows its Turns, trajectory, Reflections, linked Proposals, and optional outcome evaluations
    And the user can return to the same Work list page
    And reloading the Work URL restores the same detail

  Scenario: Read a long Work conversation
    Given a Work contains multiple Turns with user requests, agent replies, context and actions
    When the user reads its trajectory
    Then the requests and replies appear in Turn order as a conversation
    And context provenance, command receipts, errors and pinned OM revisions remain inspectable
    And earlier Turns can be revealed in groups without expanding every recorded event
    And the user can jump to the latest Turn without losing earlier Turns

  Scenario: Review a Reflection and its Proposal together
    Given a Work Reflection has produced an OM Proposal
    When the user selects that Reflection
    Then its analysis, evidence, conversation and Proposal are available in the Reflection workspace
    And the user can review, rebase and adopt the Proposal there
    And the Work conversation remains available in its own view

  Scenario: Discuss the Work and record an explicit outcome evaluation
    Given a user can read a Work and its trajectory
    When the user discusses that Work with the Reflection Agent
    Then the discussion remains in the Reflection workspace
    And the trajectory view remains a read-only history of the Work
    When the Work owner records an optional structured outcome evaluation
    Then it is identified as the owner's evaluation for the measurement baseline
    And the Reflection Agent's discussion does not silently create that evaluation

  Scenario: Work list and detail respect resource ownership
    Given an administrator may inspect another user's Works
    When the administrator chooses that user on the Work list
    Then only that user's Works are paginated
    And the administrator can open an authorized Work detail
    When a normal user requests another user's list or Work URL
    Then the server refuses access

  Scenario: Admin filters are part of each resource list
    Given an administrator can inspect Works and Proposals from multiple users
    When the administrator filters Works by user, Work type, and status
    Then the matching total and every page use all selected filters
    And changing a filter starts at the first page without losing another filter
    And returning from a Work detail restores the same filtered list page
    When the administrator filters Proposals by user, status, and source
    Then the list and total contain only matching Proposals
    And the user selector is shown alongside the other filters, not as a separate content section
    And a regular user cannot use either list to read another user's resources

  Scenario: Invalid page input
    When a client requests page zero, a noninteger page, or an excessive page number
    Then the server rejects the request instead of scanning an unbounded list
