# Floatify Component Styles

## Purpose

Defines dark theme styling for individual UI components including navbar, data table, filter form, login page, home page, status badges, footer, and page headings.

## Requirements

### Requirement: Dark glassmorphism navbar

The navbar SHALL use a dark semi-transparent background with backdrop blur, matching the Floatify navigation style. Height SHALL remain 56px (current value, optimized for admin tool vertical space). The brand/logo text SHALL use the gradient-text class.

#### Scenario: Navbar renders with glass effect

- **WHEN** the navbar is displayed
- **THEN** the background SHALL be semi-transparent dark with `backdrop-filter: blur(20px)`
- **AND** the height SHALL be 56px
- **AND** the brand text SHALL use the gradient-text effect
- **AND** nav links SHALL show a subtle glass highlight on hover and active states

### Requirement: Dark data table with readable cells

The data table SHALL render with a glass card wrapper. Table cells SHALL use opaque dark backgrounds for readability. Header rows SHALL use an elevated dark background. Row hover effects SHALL use a subtle purple-tinted highlight.

#### Scenario: Table renders in dark theme

- **WHEN** a data table is displayed
- **THEN** the table wrapper SHALL use the glass card effect (semi-transparent, blurred)
- **AND** table cells SHALL use opaque `--bg-card` backgrounds (not translucent glass)
- **AND** header cells SHALL use an elevated dark background
- **AND** row hover SHALL use a subtle purple-tinted highlight
- **AND** pagination active button SHALL use the gradient accent background

### Requirement: Dark filter form with readable inputs

Filter form inputs and selects SHALL have opaque dark backgrounds for comfortable data entry. Focus states SHALL use purple-accent borders.

#### Scenario: Filter inputs render in dark theme

- **WHEN** filter form inputs are displayed
- **THEN** input backgrounds SHALL be opaque dark (`--bg-input`)
- **AND** text color SHALL be white/light
- **AND** focus state SHALL show a purple border (`#667EEA`)
- **AND** primary action buttons SHALL use the gradient accent

### Requirement: Dark login page

The login page SHALL display a centered glass card on a dark background with gradient decorative elements.

#### Scenario: Login page renders in dark theme

- **WHEN** the login page is displayed
- **THEN** the page background SHALL be the deep dark color
- **AND** the login card SHALL use the glassmorphism effect
- **AND** the submit button SHALL use the gradient accent

### Requirement: Dark home page with gradient stat cards

Home page stat cards SHALL use gradient backgrounds (purple, blue, green variants) on dark glass cards. The page heading SHALL use the gradient-text class.

#### Scenario: Home page renders with gradients

- **WHEN** the home page is displayed
- **THEN** stat cards SHALL use gradient accent backgrounds
- **AND** card content areas SHALL use the glass card effect
- **AND** schedule items SHALL have colored left borders on dark backgrounds
- **AND** the page H1 heading SHALL use the gradient-text effect

### Requirement: Updated status badge colors for dark theme

Status badges SHALL use semi-transparent colored backgrounds that provide sufficient contrast on dark surfaces. The existing CSS variable approach in `StatusBadge.tsx` SHALL continue to work — updated variable values will provide correct dark-theme colors.

#### Scenario: Status badges readable on dark background

- **WHEN** a status badge is rendered on a dark background
- **THEN** the badge background SHALL be semi-transparent (e.g., `rgba(52, 211, 153, 0.2)` for success)
- **AND** the text color SHALL be the bright variant of the status color
- **AND** contrast ratio SHALL meet WCAG AA standards

### Requirement: Dark footer styling

The footer SHALL use a dark background consistent with the overall theme, with muted text.

#### Scenario: Footer renders in dark theme

- **WHEN** the footer is displayed
- **THEN** the background SHALL match or complement the dark page background
- **AND** text SHALL use the secondary (muted) text color

### Requirement: Gradient text on page headings

All main page H1 headings SHALL use the `.gradient-text` class for the Floatify multi-color text effect.

#### Scenario: Page headings use gradient text

- **WHEN** a page (Home, Students, Leads, Programs) is displayed
- **THEN** the primary H1 heading SHALL have the `gradient-text` class applied
- **AND** the text SHALL display the purple → pink → green gradient
