## ADDED Requirements

### Requirement: Inter font family

All text SHALL use the Inter font family with system-ui fallback. Font weights 400, 500, 600, 700, and 800 SHALL be available. DM Mono and DM Sans SHALL be completely removed.

#### Scenario: Font family applied globally

- **WHEN** any page renders text
- **THEN** the font family SHALL be `'Inter', system-ui, -apple-system, sans-serif`
- **AND** font rendering SHALL use `-webkit-font-smoothing: antialiased`
- **AND** no DM Mono or DM Sans references SHALL remain in CSS or HTML

### Requirement: Base font size 16px

The html root font size SHALL be 16px. Body text SHALL render at 15-16px minimum for comfortable reading during extended admin sessions.

#### Scenario: Root font size

- **WHEN** the application loads
- **THEN** the html element SHALL have `font-size: 16px`
- **AND** body line-height SHALL be 1.6

#### Scenario: Body text minimum size

- **WHEN** body text, descriptions, or paragraph content is rendered
- **THEN** the font-size SHALL be 15px or larger

### Requirement: Heading hierarchy

Headings SHALL use a clear size and weight hierarchy optimized for the Inter font.

#### Scenario: H1 page titles

- **WHEN** an H1 heading is displayed on any page
- **THEN** the font-size SHALL be 28px or larger
- **AND** font-weight SHALL be 700 or 800
- **AND** letter-spacing SHALL be -0.02em
- **AND** color SHALL be `#1A202C`

#### Scenario: H2 section headings

- **WHEN** an H2 heading is displayed
- **THEN** the font-size SHALL be 22px or larger
- **AND** font-weight SHALL be 700

#### Scenario: H3 subsection headings

- **WHEN** an H3 heading is displayed
- **THEN** the font-size SHALL be 18px or larger
- **AND** font-weight SHALL be 600

### Requirement: Minimum label size

Labels, badges, metadata text, and table headers SHALL never render below 12px font-size.

#### Scenario: Small text minimum

- **WHEN** labels, badges, eyebrow text, table headers, or metadata is rendered
- **THEN** the font-size SHALL be 12px or larger
- **AND** font-weight SHALL be 500 or higher for labels
- **AND** secondary text SHALL use `#4A5568` for adequate contrast on light backgrounds

### Requirement: Eyebrow label styling

Eyebrow labels (section headers, table column headers) SHALL use a consistent uppercase style.

#### Scenario: Eyebrow label renders

- **WHEN** an eyebrow label or table column header is displayed
- **THEN** the font-size SHALL be 12-13px
- **AND** text-transform SHALL be uppercase
- **AND** font-weight SHALL be 600
- **AND** letter-spacing SHALL be 0.05em
- **AND** color SHALL be `#A0AEC0`
