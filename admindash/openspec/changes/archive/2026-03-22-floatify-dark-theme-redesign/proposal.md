## Why

The admin dashboard currently uses a warm, light theme with gold/bronze accents that doesn't match the company's public-facing website (floatify.com). The public site uses a modern dark glassmorphism aesthetic with purple/violet gradients. Aligning the admin dashboard's visual identity with the public site creates a cohesive brand experience — while adapting the design for an admin tool where users spend extended time working with data tables, forms, and dense information.

## What Changes

- Replace the light warm color palette with a dark theme using deep purple/violet backgrounds
- Keep DM Sans / DM Mono fonts (visually similar to Floatify's Inter, avoids layout risk)
- Introduce glassmorphism effects on UI chrome (navbar, card wrappers, page containers)
- Use higher-contrast opaque backgrounds for data-dense areas (tables, form inputs) to support extended use
- Add gradient accents (purple → violet) for buttons, active states, and highlights
- Add gradient text effect to brand name in navbar and page H1 headings
- Update all component styles: navbar, cards, tables, forms, badges, buttons
- Add radial gradient background decorations for visual depth
- Update shadows from subtle light-theme shadows to dark-theme glows

## Capabilities

### New Capabilities
- `dark-glassmorphism-theme`: Global dark theme with CSS variable overhaul, glassmorphism effects for chrome, adapted readability for data areas, and gradient accents — applied across all existing components
- `floatify-component-styles`: Updated component-level styles (navbar, data table, filter form, status badges, login page, home page) to match the Floatify design language

### Modified Capabilities
<!-- No existing specs to modify -->

## Impact

- `frontend/src/index.css`: Complete CSS variable overhaul (colors, fonts, shadows, radii)
- `frontend/src/App.css`: Dark background app shell
- `frontend/src/components/Navbar.css`: Dark glassmorphism navbar with backdrop blur
- `frontend/src/components/DataTable.css`: Dark table with glass card wrapper
- `frontend/src/components/FilterForm.css`: Dark inputs with purple focus states
- `frontend/src/components/Footer.css`: Dark footer
- `frontend/src/pages/LoginPage.css`: Dark glassmorphism login card
- `frontend/src/pages/HomePage.css`: Dark stat cards with gradient accents
- `frontend/src/pages/StudentsPage.css`, `LeadPage.css`, `ProgramPage.css`: Dark page styles
- `frontend/src/components/StatusBadge.tsx`: Updated badge colors for dark theme contrast
- Page component TSX files: Add `gradient-text` class to page H1 headings
