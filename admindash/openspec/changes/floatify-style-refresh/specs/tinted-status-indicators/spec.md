## ADDED Requirements

### Requirement: Tinted color pairs for semantic elements

Status badges, semantic indicators, and colored elements SHALL use tinted background + dark text pairs from the Floatify palette for clear visibility on light surfaces.

#### Scenario: Blue tinted pair

- **WHEN** an element needs blue semantic coloring (info, primary)
- **THEN** background SHALL be `#E6F1FB` and text SHALL be `#185FA5`

#### Scenario: Pink tinted pair

- **WHEN** an element needs pink semantic coloring (danger, withdrawn)
- **THEN** background SHALL be `#FBEAF0` and text SHALL be `#993556`

#### Scenario: Green tinted pair

- **WHEN** an element needs green semantic coloring (success, active)
- **THEN** background SHALL be `#EAF3DE` and text SHALL be `#3B6D11`

#### Scenario: Amber tinted pair

- **WHEN** an element needs amber semantic coloring (warning, on-leave)
- **THEN** background SHALL be `#FAEEDA` and text SHALL be `#854F0B`

### Requirement: Status badge color mapping

StatusBadge component SHALL map enrollment/student statuses to specific tinted pairs. Inline styles in StatusBadge.tsx SHALL use the same hex tint values defined in the CSS custom properties.

#### Scenario: Active and Enrolled statuses

- **WHEN** a status badge shows "Active" or "Enrolled"
- **THEN** the badge SHALL use green tinted pair (bg `#EAF3DE`, text `#3B6D11`)

#### Scenario: On Leave status

- **WHEN** a status badge shows "On Leave"
- **THEN** the badge SHALL use amber tinted pair (bg `#FAEEDA`, text `#854F0B`)

#### Scenario: Suspended and info statuses

- **WHEN** a status badge shows "Suspended"
- **THEN** the badge SHALL use blue tinted pair (bg `#E6F1FB`, text `#185FA5`)

#### Scenario: Graduated status

- **WHEN** a status badge shows "Graduated"
- **THEN** the badge SHALL use blue accent pair (bg `#E6F1FB`, text `#378ADD`)

#### Scenario: Dropped and Withdrawn statuses

- **WHEN** a status badge shows "Dropped" or "Withdrawn"
- **THEN** the badge SHALL use pink tinted pair (bg `#FBEAF0`, text `#993556`)

### Requirement: CSS custom properties for tinted pairs

Tinted color pairs SHALL be defined as CSS custom properties in `:root` for reuse across components.

#### Scenario: Tinted variables defined

- **WHEN** the application loads
- **THEN** `:root` SHALL contain `--tint-blue-bg`, `--tint-blue-text`, `--tint-pink-bg`, `--tint-pink-text`, `--tint-green-bg`, `--tint-green-text`, `--tint-amber-bg`, `--tint-amber-text`
- **AND** values SHALL match the Floatify design system exactly

### Requirement: Badge visual style

Badges SHALL use a pill shape with consistent padding and sizing.

#### Scenario: Badge renders with pill shape

- **WHEN** a badge or status indicator is rendered
- **THEN** border-radius SHALL be 20px (fully rounded pill)
- **AND** padding SHALL be 2-4px vertical, 10-12px horizontal
- **AND** font-size SHALL be 12px
- **AND** font-weight SHALL be 600
