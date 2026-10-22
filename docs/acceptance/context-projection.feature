Feature: Native Pi execution with governed Work capabilities
  Scenario: Resume a fixed Work identity
    Given a persistent Pi session and source-linked workspace notes
    When the same Work continues in a new Turn or a restarted runtime
    Then its explicit session file is reopened
    And native history and notes remain available without a second conversation summary

  Scenario: Provenance changes create a new native epoch
    Given a Work has a native session
    When its OM revision, tool snapshot or model configuration changes
    Then a new native session is created and the original is retained
    And source-linked workspace notes remain available
    And another user or Work cannot be selected by guessing the latest session

  Scenario: Native compression preserves task continuity
    Given the Agent has read source pages and written findings to a working note
    When Pi compacts the history and the runtime is reopened
    Then the Agent can read that note and save a draft through MCP
    And it does not restart reading every source page
    And an actual committed receipt is required before claiming a saved draft

  Scenario: MCP keeps business and Reflection authority distinct
    Given Work tools are discovered from the current immutable App snapshot
    When Pi searches deferred MCP tools
    Then calls use the original scoped use cases and receipts
    And Reflection only has its original trajectory and candidate capabilities
    And bridge credentials expire when the run ends
