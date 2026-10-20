Feature: Git owns OM content and contribution lifecycle
  Scenario: Draft changes survive a restart without becoming active
    Given an owner has an active personal OM commit
    When the owner saves changes in a reflection scope
    Then those changes are uncommitted files in an isolated detached worktree
    And the personal branch is unchanged
    And restarting the service restores the same draft from Git

  Scenario: Confirm or discard a draft
    Given an owner has an uncommitted draft
    When the owner confirms the current draft with a change reason
    Then a commit records its content, author, source and reason
    And the personal branch fast forwards to that commit
    And the draft worktree is removed

  Scenario: Select and accept a contribution
    Given a personal revision differs from organization main
    When an administrator creates a contribution
    Then a contribution branch records the fixed source, author and reason
    When the administrator saves selected paths
    Then a three-way patch commit is appended to that branch
    And organization main is unchanged
    When the administrator accepts the current contribution revision
    Then organization main receives a merge commit
    And contribution status is derived as accepted from Git ancestry

  Scenario: External Git operations are visible
    Given a contribution branch exists
    When it is merged into main using the Git CLI
    Then the contribution is shown as accepted without a database update
    When another commit is appended to that branch
    Then the contribution is shown as open
    And acceptance using the previously observed revision is rejected

  Scenario: Failed acceptance preserves data
    Given main advanced since selection or selected content is invalid
    When an administrator attempts acceptance
    Then acceptance is rejected
    And main and the contribution branch remain unchanged

  Scenario: Abandon an open contribution
    Given an open contribution branch exists
    When an administrator explicitly abandons that contribution
    Then the contribution branch is removed
    And main and the personal source branch remain unchanged
