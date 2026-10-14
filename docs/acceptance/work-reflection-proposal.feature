Feature: Work Reflection and OM Proposal ownership

  Scenario: A Reflection reply is observable before generation finishes
    Given the owner has sent a message in an active Reflection
    When the Agent produces answer text and executes an authorized tool
    Then the owner can read the growing answer before the run completes
    And tool names and execution status are observable without private inputs or reasoning
    And only a validated final answer becomes a completed conversation message

  Scenario: Disconnecting does not stop a Reflection run
    Given a Reflection run is generating a reply
    When the owner disconnects and later returns
    Then the same run continues without resubmitting the question
    And its current answer and execution state are restored without duplicated text
    And repeating the original request ID does not add another user message

  Scenario: The owner explicitly stops generation
    Given a Reflection run has already saved a candidate file
    When the owner requests cancellation
    Then no new candidate write begins after cancellation is requested
    And the run remains exclusive until its in-flight tool has settled
    And saved candidate changes remain available for review and are not adopted automatically
    And partial answer text is identified as incomplete rather than a completed Agent message
    And the owner can continue the same Reflection after the run settles

  Scenario: Proposal governance cannot race a Reflection run
    Given a Reflection run is generating or stopping
    When a user attempts to modify, review, rebase, adopt or abandon its Proposal
    Then the operation is rejected while the run remains active
    And the same protection applies to the workspace and App session entry points

  Scenario: An interrupted server does not replay candidate writes
    Given a Reflection run was active when the server stopped unexpectedly
    When the server starts again
    Then the run is marked interrupted and its saved answer remains readable
    And the server does not automatically rerun the question or its tools

  Scenario: Opening a Work Reflection reuses its continuous session
    Given a user owns a Work
    When the user opens Reflection for that Work
    Then one Reflection session exists with an agent introduction
    And reopening Reflection returns that same session
    And the first user message and later messages continue that same agent session
    And a recoverable agent failure leaves the conversation readable

  Scenario: Earlier Reflection records remain readable after migration
    Given a Work has multiple Reflection records from the earlier workflow
    When its owner opens Reflection
    Then the earliest session is selected as the continuing session
    And no additional session is created

  Scenario: Trajectory is a bounded read-only resource of the session
    Given a Reflection session belongs to a Work
    When its agent requests trajectory events
    Then it can read only events of that Work in bounded pages
    And only events actually returned to the agent may support a proposed change
    And the agent cannot call App business commands from Reflection

  Scenario: A lens is invoked inside the conversation
    Given an administrator has enabled a built-in lens
    When the user sends its slash command in a Reflection session
    Then that invocation uses the current version of the lens prompt
    And the lens version and cited trajectory events remain attributable
    And a disabled or unknown lens command is rejected without creating a proposal

  Scenario: Reflection citations navigate to the source conversation
    Given a Reflection Agent message cites trajectory events from its Work
    When the user follows a cited event from that message
    Then the Work conversation opens at the exact event, including an earlier Turn
    And the cited event is identifiable and its original content remains readable
    And the user can return to the same Reflection conversation
    And an event absent from the readable Work trajectory is not presented as a working link

  Scenario: Reflection produces an independently governed Proposal
    Given a Reflection identifies an OM change with supporting evidence
    When the candidate files are written
    Then the Work shows a link to the resulting Proposal
    And the Proposal has its own base revision, branch, and worktree
    And the user reviews, rebases, and adopts it through the Proposal workflow
    And adoption changes only subsequent Turns
    And the Reflection becomes completed while its conversation remains readable

  Scenario: The owner abandons a Reflection Proposal
    Given a Reflection has an open Proposal
    When its owner abandons the Proposal
    Then the Proposal and Reflection become abandoned
    And the conversation remains readable with a closing message
    And no OM commit is created
    And the Proposal cannot be edited, reviewed, or adopted

  Scenario: API Suggestion does not create an empty Proposal
    Given a Work Reflection identifies an API capability gap
    When the result contains only an API Suggestion
    Then the suggestion is readable and exportable from that Work
    And no Proposal worktree is created

  Scenario: Personal OM editing keeps a private draft before Reflection proposes a change
    Given a user is reading the active revision of their personal OM
    When the user edits a file there and saves a draft
    Then the draft remains available after leaving the OM page
    And saving it does not change the active HEAD
    And no Proposal is created until a Reflection yields a supported OM change
    And an authorized Reflection lens can reference that draft when its base matches the pinned OM revision

  Scenario: Organization sync uses Proposal without inventing a Reflection
    Given organization main contains updates absent from the user's branch
    When the user requests synchronization
    Then the system creates a Proposal with a separate worktree
    And no Work or Reflection is fabricated
    And conflicts and a stale active HEAD must be resolved before adoption

  Scenario: A Work Definition manifest can be inspected at a pinned OM revision
    Given a user can read an OM branch at a reachable revision
    When the user inspects a work.yml document
    Then its documents, knowledge references, allowed capabilities and completion rule are visible as structured content
    And the original YAML remains available for comparison
    And a historical revision is read-only
