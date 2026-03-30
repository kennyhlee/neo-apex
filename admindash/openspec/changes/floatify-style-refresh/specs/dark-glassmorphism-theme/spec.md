## RENAMED Requirements

### Requirement: Dark color palette via CSS variables
FROM: Dark color palette via CSS variables
TO: Light color palette via CSS variables

### Requirement: Two-tier background strategy
FROM: Two-tier background strategy
TO: Clean surface strategy

### Requirement: Gradient accent styling
FROM: Gradient accent styling
TO: Solid accent styling

### Requirement: Dark theme shadows
FROM: Dark theme shadows
TO: Light theme shadows

### Requirement: Decorative background gradients
FROM: Decorative background gradients
TO: Clean background

## MODIFIED Requirements

### Requirement: Light color palette via CSS variables

The system SHALL define a light color palette using CSS custom properties in `index.css`. Background colors SHALL use light slate tones (`#F8FAFC` for page background, `#FFFFFF` for cards and surfaces). Text colors SHALL be dark (`#1A202C` for primary, `#4A5568` for secondary, `#A0AEC0` for tertiary). The primary accent color SHALL be blue (`#378ADD`) with supporting accents pink (`#D4537E`), green (`#639922`), and amber (`#EF9F27`). Semantic colors (success, danger, info, warning) SHALL use Floatify palette values readable on light backgrounds.

#### Scenario: CSS variables define light palette

- **WHEN** the application loads
- **THEN** all CSS custom properties (`--bg-primary`, `--bg-card`, `--text-primary`, `--accent`, etc.) SHALL resolve to light theme values matching the Floatify/papermite design system
- **AND** all components using these variables SHALL render with the light palette without code changes

### Requirement: Clean surface strategy

The system SHALL use clean white surfaces for all UI elements. Cards, inputs, and elevated areas SHALL use opaque white (`#FFFFFF`) backgrounds with subtle borders (`#E2E8F0`) and soft shadows. Page backgrounds SHALL use light slate (`#F8FAFC`). Tertiary backgrounds SHALL use `#F1F5F9`.

#### Scenario: Card renders with clean white surface

- **WHEN** a card, container, or elevated element is rendered
- **THEN** the background SHALL be opaque white (`#FFFFFF`)
- **AND** the border SHALL be `1px solid #E2E8F0`
- **AND** the box-shadow SHALL be `0 4px 16px rgba(0,0,0,0.06)`
- **AND** no `backdrop-filter` property SHALL be applied

#### Scenario: Input renders with white background

- **WHEN** a form input or select is rendered
- **THEN** the background SHALL be opaque white (`#FFFFFF`)
- **AND** text contrast SHALL support comfortable reading during extended use

### Requirement: Solid accent styling

Primary action elements (buttons, active states) SHALL use a solid blue background (`#378ADD`) with white text. The `.gradient-text` utility class SHALL be removed and replaced with solid accent-colored or dark text.

#### Scenario: Primary button renders with solid blue

- **WHEN** a primary action button is displayed
- **THEN** the background SHALL be solid `#378ADD` (not a gradient)
- **AND** text SHALL be white
- **AND** hover state SHALL lift the button with `translateY(-2px)` and show a blue glow shadow (`0 8px 32px rgba(55,138,221,0.3)`)

#### Scenario: Brand and page headings use solid text color

- **WHEN** a heading or brand text is rendered
- **THEN** the text SHALL use solid dark color (`#1A202C`) or accent blue (`#378ADD`)
- **AND** no gradient-text effect SHALL be applied

### Requirement: Light theme shadows

Box shadows SHALL use neutral dark tones at low opacity for subtle depth. Card shadows SHALL use `0 4px 16px rgba(0,0,0,0.06)`. Elevated shadows SHALL use `0 8px 24px rgba(0,0,0,0.08)`.

#### Scenario: Card shadow renders as subtle depth

- **WHEN** a card component is displayed
- **THEN** the box-shadow SHALL use neutral rgba values creating subtle depth
- **AND** no purple-tinted or colored glow SHALL be used in shadows

### Requirement: Clean background

The body background SHALL be a clean solid `#F8FAFC` color. All radial gradient decorations and low-opacity decorative circles SHALL be removed.

#### Scenario: Background shows clean solid color

- **WHEN** the application is viewed
- **THEN** the body background SHALL be solid `#F8FAFC`
- **AND** no radial gradient overlays or decorative pseudo-elements SHALL be present

## REMOVED Requirements

### Requirement: No glassmorphism
**Reason**: Glassmorphism (backdrop-filter blur, semi-transparent rgba backgrounds) is incompatible with the light theme and has been removed across all components.
**Migration**: All glass effects replaced with opaque white backgrounds, solid borders, and soft shadows.
