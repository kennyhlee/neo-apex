# Spec: Dark Theme

## MODIFIED Requirements

### Requirement: Consistent Dark Visual Language

All pages after login must share the same dark aesthetic established by the login page.

#### Scenario: Color palette consistency

- **WHEN** a user logs in and sees any app page
- **THEN** the background is deep dark (#0F0A1A or similar)
- **AND** cards use glassmorphism (semi-transparent, backdrop-blur, subtle white borders)
- **AND** accent color is purple/violet (#667EEA primary, #7C3AED hover)
- **AND** text uses white/light hierarchy (primary white, secondary 60% white, tertiary 40% white)

#### Scenario: Button styling

- **WHEN** a primary button is rendered on any page
- **THEN** it uses a purple-to-violet gradient background
- **AND** it lifts on hover with a purple glow shadow
- **AND** disabled state reduces opacity

#### Scenario: Input styling

- **WHEN** an input or select is rendered
- **THEN** it has a semi-transparent dark background
- **AND** border is subtle white (rgba)
- **AND** focus state shows purple border with purple ring

#### Scenario: App header

- **WHEN** the user is on any authenticated page
- **THEN** the header uses a dark background matching the page
- **AND** the logo text uses the gradient treatment from login
- **AND** the logout button is visible and properly themed

#### Scenario: No light-to-dark flash

- **WHEN** transitioning from login to any page
- **THEN** the visual style is continuous — no color palette jump
