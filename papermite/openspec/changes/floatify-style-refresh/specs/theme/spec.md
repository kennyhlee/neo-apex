## RENAMED Requirements

### Requirement: Consistent Dark Visual Language
FROM: Consistent Dark Visual Language
TO: Consistent Visual Language

## MODIFIED Requirements

### Requirement: Consistent Visual Language

All pages after login SHALL use a clean light aesthetic inspired by Floatify's design system, replacing the previous dark theme.

#### Scenario: Color palette consistency

- **WHEN** a user logs in and sees any app page
- **THEN** the background is light slate (#F8FAFC)
- **AND** cards use white backgrounds with subtle borders (#E2E8F0) and soft shadows
- **AND** primary accent color is blue (#378ADD)
- **AND** text uses dark hierarchy (primary #1A202C, secondary #4A5568, muted #A0AEC0)

#### Scenario: Button styling

- **WHEN** a primary button is rendered on any page
- **THEN** it uses a solid blue (#378ADD) background with white text
- **AND** it lifts on hover with a blue glow shadow (translateY -2px)
- **AND** disabled state reduces opacity

#### Scenario: Input styling

- **WHEN** an input or select is rendered
- **THEN** it has a white background with light border (#E2E8F0)
- **AND** focus state shows blue border with subtle blue ring

#### Scenario: App header

- **WHEN** the user is on any authenticated page
- **THEN** the header uses a light background matching the page
- **AND** the logo text uses the accent blue color or gradient treatment
- **AND** the logout button is visible and properly themed

#### Scenario: No light-to-dark flash

- **WHEN** transitioning from login to any page
- **THEN** the visual style is continuous — consistent light palette throughout

## ADDED Requirements

### Requirement: Readable Typography

All text SHALL use Inter font with sizes optimized for extended reading sessions.

#### Scenario: Font family and base size

- **WHEN** any page renders text
- **THEN** the font family is Inter (with system-ui fallback)
- **AND** the base body font size is 16px minimum
- **AND** font rendering uses antialiased smoothing

#### Scenario: Heading hierarchy

- **WHEN** headings are displayed
- **THEN** h1 uses 28px+ weight 700-800 with letter-spacing -0.02em
- **AND** h2 uses 22px+ weight 700
- **AND** h3 uses 18px+ weight 600
- **AND** all headings use dark primary text color (#1A202C)

#### Scenario: Label and metadata text

- **WHEN** labels, badges, or metadata text is displayed
- **THEN** minimum font size is 12px (never below)
- **AND** secondary text uses #4A5568 for adequate contrast on white/light backgrounds

#### Scenario: Line height for readability

- **WHEN** body text or descriptions are displayed
- **THEN** line-height is 1.5 or greater for comfortable reading

### Requirement: Tinted Status Indicators

Status and semantic elements SHALL use colored tint pairs for clear visual distinction on light backgrounds.

#### Scenario: Badge and status colors

- **WHEN** a badge, status indicator, or semantic element is rendered
- **THEN** it uses a tinted background with matching dark text:
  - Blue: background #E6F1FB, text #185FA5
  - Pink: background #FBEAF0, text #993556
  - Green: background #EAF3DE, text #3B6D11
  - Amber: background #FAEEDA, text #854F0B

#### Scenario: Base vs custom field badges

- **WHEN** a field is marked as base_model or custom_field
- **THEN** base fields use blue tint pair (blue bg, blue text)
- **AND** custom fields use green tint pair (green bg, green text)

### Requirement: No Glassmorphism

Cards and containers SHALL NOT use backdrop-filter blur or semi-transparent rgba backgrounds.

#### Scenario: Card rendering

- **WHEN** any card or container component is rendered
- **THEN** it uses an opaque white background (#FFFFFF)
- **AND** border is 1px solid #E2E8F0
- **AND** shadow is soft (e.g., 0 4px 16px rgba(0,0,0,0.06))
- **AND** no backdrop-filter property is applied
