## RENAMED Requirements

### Requirement: Dark glassmorphism navbar
FROM: Dark glassmorphism navbar
TO: Light theme navbar

### Requirement: Dark data table with readable cells
FROM: Dark data table with readable cells
TO: Light data table with readable cells

### Requirement: Dark filter form with readable inputs
FROM: Dark filter form with readable inputs
TO: Light filter form with readable inputs

### Requirement: Dark login page
FROM: Dark login page
TO: Light login page

### Requirement: Dark home page with gradient stat cards
FROM: Dark home page with gradient stat cards
TO: Light home page with tinted stat cards

### Requirement: Updated status badge colors for dark theme
FROM: Updated status badge colors for dark theme
TO: Status badge colors for light theme

### Requirement: Dark footer styling
FROM: Dark footer styling
TO: Light footer styling

## MODIFIED Requirements

### Requirement: Light theme navbar

The navbar SHALL use a light background matching the page with a subtle bottom border. Height SHALL remain 56px. The brand/logo text SHALL use accent blue (`#378ADD`) color instead of the gradient-text class. Nav links SHALL show accent-blue highlight on active state and subtle hover effect.

#### Scenario: Navbar renders with light theme

- **WHEN** the navbar is displayed
- **THEN** the background SHALL be light (white or `#F8FAFC`) with no backdrop-filter
- **AND** a bottom border of `1px solid #E2E8F0` SHALL separate it from content
- **AND** the height SHALL be 56px
- **AND** the brand text SHALL use `#378ADD` color (not gradient-text)
- **AND** nav links SHALL show accent-blue background on active and subtle hover

### Requirement: Light data table with readable cells

The data table SHALL render with a clean white card wrapper with subtle border and shadow. Table cells SHALL use white backgrounds. Header rows SHALL use light gray background (`#F1F5F9`). Row hover effects SHALL use a subtle blue-tinted highlight.

#### Scenario: Table renders in light theme

- **WHEN** a data table is displayed
- **THEN** the table wrapper SHALL be a white card with `1px solid #E2E8F0` border and soft shadow
- **AND** table cells SHALL use white backgrounds
- **AND** header cells SHALL use `#F1F5F9` background with uppercase 12px labels in `#A0AEC0`
- **AND** row hover SHALL use `rgba(55,138,221,0.06)` highlight
- **AND** pagination active button SHALL use solid blue (`#378ADD`) background

### Requirement: Light filter form with readable inputs

Filter form inputs and selects SHALL have white backgrounds with light borders for comfortable data entry. Focus states SHALL use blue accent borders with subtle ring.

#### Scenario: Filter inputs render in light theme

- **WHEN** filter form inputs are displayed
- **THEN** input backgrounds SHALL be white
- **AND** borders SHALL be `1px solid #E2E8F0`
- **AND** text color SHALL be dark (`#1A202C`)
- **AND** focus state SHALL show blue border (`#378ADD`) with ring (`0 0 0 3px rgba(55,138,221,0.15)`)
- **AND** primary action buttons SHALL use solid blue (`#378ADD`)

### Requirement: Light login page

The login page SHALL display a centered white card on a light background with subtle decorative elements.

#### Scenario: Login page renders in light theme

- **WHEN** the login page is displayed
- **THEN** the page background SHALL be light slate (`#F8FAFC`)
- **AND** the login card SHALL be white with border-radius 20px and soft shadow
- **AND** the submit button SHALL use solid blue (`#378ADD`) background
- **AND** optional subtle radial gradient decorations SHALL use `rgba(55,138,221,0.08)` blue and `rgba(212,83,126,0.06)` pink at low opacity

### Requirement: Light home page with tinted stat cards

Home page stat cards SHALL use tinted color pairs on white cards instead of gradient backgrounds. The page heading SHALL use dark text color instead of gradient-text.

#### Scenario: Home page renders with tinted stat cards

- **WHEN** the home page is displayed
- **THEN** stat value pills SHALL use tinted backgrounds (blue `#E6F1FB`, green `#EAF3DE`, amber `#FAEEDA`) with matching dark text
- **AND** card content areas SHALL be white with subtle borders and shadows
- **AND** schedule items SHALL have colored left borders on white backgrounds
- **AND** the page H1 heading SHALL use dark text (`#1A202C`) without gradient effect

### Requirement: Status badge colors for light theme

Status badges SHALL use tinted color pairs that provide clear contrast on white/light surfaces. Colors SHALL match the Floatify palette system.

#### Scenario: Status badges readable on light background

- **WHEN** a status badge is rendered on a light background
- **THEN** the badge background SHALL use a tinted color (e.g., `#EAF3DE` for success)
- **AND** the text color SHALL use the dark variant of the status color (e.g., `#3B6D11` for success)
- **AND** contrast ratio SHALL meet WCAG AA standards on white surfaces

### Requirement: Light footer styling

The footer SHALL use a background consistent with the light theme, with muted text.

#### Scenario: Footer renders in light theme

- **WHEN** the footer is displayed
- **THEN** the background SHALL be white or light slate matching the page
- **AND** text SHALL use the secondary text color (`#4A5568`)
- **AND** a top border of `1px solid #E2E8F0` SHALL separate it from content

### Requirement: Solid text on page headings

All main page H1 headings SHALL use solid dark text color (`#1A202C`) with font-weight 700-800 instead of the gradient-text effect.

#### Scenario: Page headings use solid dark text

- **WHEN** a page (Home, Students, Leads, Programs) is displayed
- **THEN** the primary H1 heading SHALL use `#1A202C` color with font-weight 700-800
- **AND** font-size SHALL be 28px or larger
- **AND** letter-spacing SHALL be -0.02em
- **AND** no gradient-text class or effect SHALL be applied
