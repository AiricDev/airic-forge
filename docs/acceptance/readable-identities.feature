Feature: Readable names for workspace objects
  Scenario: A Work has an authoritative business object name
    Given the App supplies the report project name in its authorized context
    When the user opens that Work from the App
    Then the Work remembers the name for its list, dashboard and detail
    And its identity and access rules remain unchanged

  Scenario: An older Work has no saved name
    Given a Work predates saved business object names
    When the user views it
    Then its type and creation time identify it instead of an opaque ID
    And opening it from the App can supply its missing name

  Scenario: Technical identifiers remain available without dominating the display
    When the user views a Proposal, Reflection, OM version or capability catalog
    Then the display uses a reason, title, version description or release name
    And the real identifier is available on hover where useful
    And technical identifiers remain unchanged in links and API requests

  Scenario: A Reflection source has an opaque event ID
    When the user follows a numbered source reference
    Then the original trajectory event is revealed
    And the reference does not display the event ID as its name
