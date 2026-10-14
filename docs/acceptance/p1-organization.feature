Feature: Organization Operating Model governance

  Scenario: An administrator compares a personal branch with the organization
    Given a member has adopted a personal OM improvement
    When an administrator inspects that member's contribution candidate
    Then the author, source revision, changed files, diff, and private evidence are available to the administrator
    And another member cannot inspect the author's Work or contribution evidence

  Scenario: Selective organization absorption
    Given an administrator selects a subset of changed OM files
    When the selection and its dependencies validate against the current main revision
    And the administrator accepts the reviewed candidate while main is unchanged
    Then main contains only the selected files and required dependencies
    And the organization commit records the author, source revision, reason, and base revision
    And the author's active branch remains unchanged
    And private Session, trajectory, and App token data are absent from main

  Scenario: A stale organization review
    Given an organization candidate was reviewed against a particular main HEAD
    When main HEAD changes before acceptance
    Then acceptance is refused and a new review is required

  Scenario: A member synchronizes organization changes
    Given main has changed since a member's personal branch diverged
    When the member requests synchronization
    Then a separate Proposal replays personal changes onto main
    And conflicts are visible and manually resolvable in that Proposal
    And the member's active HEAD remains unchanged until review and acceptance
    And an earlier Turn can still read its original OM revision after acceptance

  Scenario: Organization content is readable without private work
    Given main contains an accepted contribution
    When another authenticated member reads organization OM
    Then they can read the published OM files and history
    But they cannot read the author's private Work, Reflection, Session, or trajectory

  Scenario: Activity and improvement observations have different meanings
    Given a member has completed a Work and reports a required human decision and an avoidable correction
    When an administrator reads the measurement baseline
    Then the two feedback categories remain separate
    And Proposal, Reflection, and contribution counts are presented as activity rather than proof of improvement
    And an ordinary member cannot read the organization-wide baseline

  Scenario: Capacity results name their sample and failure conditions
    Given an isolated temporary instance with a declared user, Work, and trajectory volume
    When concurrent reads, a truncated trajectory tail, and a restart are tested
    Then the measured timings and recovery results include that sample profile
    And no production target is inferred from the local result
