## ADDED Requirements

### Requirement: Dark color palette via CSS variables

The system SHALL define a dark color palette using CSS custom properties in `index.css`. Background colors SHALL use deep purple/dark tones (`#0F0A1A` for deep background, `#1A1230` for cards). Text colors SHALL be white (`#FFFFFF`) for primary, `rgba(255, 255, 255, 0.7)` for secondary, and `rgba(255, 255, 255, 0.4)` for tertiary. Accent colors SHALL use purple-violet gradient tones (`#667EEA`, `#764BA2`, `#A78BFA`). Semantic colors (success, danger, info, warning) SHALL use bright variants readable on dark backgrounds.

#### Scenario: CSS variables define dark palette

- **WHEN** the application loads
- **THEN** all CSS custom properties (`--bg-primary`, `--bg-card`, `--text-primary`, `--accent`, etc.) SHALL resolve to dark theme values
- **AND** all components using these variables SHALL render with the dark palette without code changes

### Requirement: Two-tier background strategy

The system SHALL distinguish between UI chrome and data-dense areas. Chrome elements (navbar, card wrappers, page containers) SHALL use glassmorphism with semi-transparent backgrounds. Data-dense areas (table cells, form inputs, filter controls) SHALL use opaque dark backgrounds (`--bg-card` or slightly lighter) for extended readability.

#### Scenario: Chrome element renders with glass effect

- **WHEN** a chrome element (navbar, card wrapper, page container) is rendered
- **THEN** the background SHALL be semi-transparent (`rgba(255, 255, 255, 0.1)`) with `backdrop-filter: blur(20px)`
- **AND** the border SHALL be `1px solid rgba(255, 255, 255, 0.2)`

#### Scenario: Data area renders with opaque background

- **WHEN** a data-dense element (table cell, form input, filter select) is rendered
- **THEN** the background SHALL use an opaque dark color (`--bg-card` or `--bg-input`)
- **AND** text contrast SHALL support comfortable reading during extended use

### Requirement: Gradient accent styling

Primary action elements (buttons, active states) SHALL use a gradient from `#667EEA` to `#764BA2` at 135 degrees. A `.gradient-text` utility class SHALL provide a multi-color text gradient effect (purple → pink → green).

#### Scenario: Primary button renders with gradient

- **WHEN** a primary action button is displayed
- **THEN** the background SHALL be a linear-gradient from `#667EEA` to `#764BA2`
- **AND** hover state SHALL lift the button with `translateY(-2px)` and increase shadow glow

#### Scenario: Gradient text applied to brand and page headings

- **WHEN** the `.gradient-text` class is applied to the navbar brand text or a page H1 heading
- **THEN** the text SHALL display a multi-color gradient (purple → pink → green)

### Requirement: Dark theme shadows

Box shadows SHALL use colored glow effects rather than dark drop shadows. Card shadows SHALL use `rgba(102, 126, 234, 0.15)` tones. Elevated shadows SHALL use `rgba(102, 126, 234, 0.35)`.

#### Scenario: Card shadow renders as colored glow

- **WHEN** a card component is displayed
- **THEN** the box-shadow SHALL use purple-tinted rgba values creating a subtle glow effect

### Requirement: Decorative background gradients

The body background SHALL include radial gradient decorations using low-opacity purple/pink circles to create visual depth, replacing the current warm noise texture overlay.

#### Scenario: Background shows gradient decorations

- **WHEN** the application is viewed
- **THEN** the body SHALL display radial gradient overlays with low opacity (0.05-0.15) creating depth
- **AND** the previous noise texture SVG overlay SHALL be removed
