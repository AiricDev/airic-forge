Feature: Personal OM changes are adopted by committing
  Scenario: A discussion is independent of business Work
    Given an owner starts a Reflection without a Work
    When the owner explicitly asks to improve the OM
    Then the agent may save attributable draft changes without inventing Work events
    And the active OM remains unchanged until the owner confirms the displayed changes
    And the same discussion can continue after committing

  Scenario: A local commit becomes active through an authenticated push
    Given an owner cloned their personal OM using their own Git token
    When they push a valid fast-forward commit to main
    Then the server activates exactly that commit without another approval
    And subsequent Turns use that revision while earlier Turns retain theirs

  Scenario: Credentials determine write authority
    Given Alice has a personal Git token
    When she accesses Bob's remote or attempts to update another ref
    Then access is rejected regardless of commit author, email or administrator role
    And another user's objects cannot be fetched by guessing their SHA

  Scenario: Concurrent modifications cannot silently overwrite each other
    Given a displayed draft has a pinned base and content digest
    When either the draft or active HEAD changes before confirmation
    Then confirmation is refused without losing saved edits
    And conflicts must be resolved before a new confirmation

  Scenario: Repeating a confirmation does not create another commit
    Given a confirmation already advanced the personal OM
    When its request identifier and digest are retried
    Then the original commit is returned

  Scenario: Organization synchronization is not a personal approval entity
    Given organization updates exist
    When an owner compares and merges those updates
    Then only a private OM draft is prepared
    And confirmation creates a merge commit preserving both histories
    And organization contribution review remains separate
