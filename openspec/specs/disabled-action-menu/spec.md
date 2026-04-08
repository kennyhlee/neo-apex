## ADDED Requirements

### Requirement: Action menu items are always visible
The action menu SHALL always display all action items (Edit Selected, Delete Selected, Export Selected) when the menu popover is open, regardless of whether any student rows are selected.

#### Scenario: Menu opened with no selection
- **WHEN** the user opens the three-dots menu and no student rows are selected
- **THEN** the menu SHALL display Edit Selected, Delete Selected, and Export Selected items in a visually disabled state

#### Scenario: Menu opened with selection
- **WHEN** the user opens the three-dots menu and one or more student rows are selected
- **THEN** the menu SHALL display Edit Selected, Delete Selected, and Export Selected items in an enabled, interactive state

### Requirement: Disabled action items are visually distinct
Action menu items SHALL be visually greyed out when they are not actionable (no selection). The disabled state MUST use the native HTML `disabled` attribute on button elements, which activates existing `.students-menu-item:disabled` CSS rules providing:
- Greyed-out text color (`var(--text-tertiary)`)
- No hover highlight effect
- A `not-allowed` cursor
The danger variant ("Delete Selected") MUST also appear greyed out when disabled, overriding its red color.

#### Scenario: Disabled item appearance
- **WHEN** a menu item is in the disabled state
- **THEN** the item text SHALL appear greyed out, the hover glow effect SHALL NOT apply, and the cursor SHALL show `not-allowed`

#### Scenario: Disabled item interaction
- **WHEN** the user clicks a disabled menu item
- **THEN** no action SHALL be triggered (no modal, no alert, no side effect)

### Requirement: Action items become enabled on selection
Action menu items SHALL transition from disabled to enabled when student rows are selected, and from enabled to disabled when all selections are cleared.

#### Scenario: Selection enables actions
- **WHEN** the user selects one or more student rows while the menu is open
- **THEN** the action items SHALL immediately become enabled (full color, hover effects active, clickable)

#### Scenario: Deselection disables actions
- **WHEN** the user deselects all student rows while the menu is open
- **THEN** the action items SHALL immediately return to the disabled state

### Requirement: Divider and section label always visible
The "Actions" section label and the divider between Actions and Columns sections SHALL always be visible when the menu is open.

#### Scenario: Section structure with no selection
- **WHEN** the menu is open and no rows are selected
- **THEN** the "Actions" section label, all action items (disabled), the divider, and the "Columns" section SHALL all be visible
