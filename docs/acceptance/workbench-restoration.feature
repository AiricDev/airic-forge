Feature: Restore the production Material UI workspace

  Scenario: Production pages are independent of the external prototype
    Given the generated prototype directory is absent
    When the production workspace is built and served by Forge
    Then login, Work, personal OM, Proposal and administration pages remain available
    And reloading a Work URL preserves its selected Reflection and source event

  Scenario: The author enters learning from the original Work
    Given the signed-in user owns a Work with recorded practice
    When they open Reflection from that Work
    Then its existing continuous Reflection is restored or created through the existing use case
    And enabled lenses, cited source events and the linked Proposal are accessible
    And only explicit author review and confirmation can adopt the Proposal

  Scenario: Administrator observation does not transfer authorship
    Given an administrator is reading another user's Work
    When they inspect its Reflection and Proposal
    Then existing discussions and candidate differences are readable
    And the author-only restriction is explained
    And sending, cancellation and adoption are unavailable

  Scenario: Streaming recovery presents a single answer
    Given a Reflection run has accepted a question
    When the connection is interrupted or its stream repeats a snapshot
    Then reconnecting reads the same run without submitting the question again
    And text snapshots replace the partial answer without duplicating chunks
    And a terminal answer is replaced by its saved message
    And a failed or stopped answer remains explicitly incomplete

  Scenario: A lost submission response cannot cause an accidental second run
    Given a Reflection submission response was lost
    When the user reconnects or retries the same submission
    Then the workspace first reconciles the current run
    And a retry preserves the original request ID
    And an unresolved request cannot be replaced by a different question

  Scenario: Historical streamed Work messages stay readable
    Given a Work contains the historical message-per-fragment trajectory
    When the workspace presents its conversation
    Then completed turns show their final answer once
    And unfinished fragments form one explicitly incomplete answer
    And following a cited fragment still reveals that original event
    And stored trajectory events are not rewritten
