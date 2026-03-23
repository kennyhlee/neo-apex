# Proposal: Dark Theme Redesign

## Why

The login page uses a polished Floatify-inspired dark glassmorphism aesthetic, but after login the app switches to a warm light theme (cream backgrounds, amber accents). This jarring transition feels like two different products. All post-login pages should share the same dark visual language.

## What Changes

- Replace the light color palette in `:root` CSS variables with a dark palette derived from the login page
- Update the app shell (header, main area) to use the dark theme
- Update all component CSS that uses hardcoded light colors or relies on the old palette semantics
- Accent color shifts from amber (`#CF8A2E`) to purple/violet (`#667EEA` → `#7C3AED`) to match login
- Glass card style (semi-transparent backgrounds, subtle borders, backdrop blur) becomes the standard card treatment
- Gradient buttons replace flat amber buttons

## Capabilities

### Modified Capabilities
- `theme`: Global color palette changes from light/warm to dark/cool with purple accents
- `card-style`: Cards shift from opaque white to glassmorphism (semi-transparent, blur, glow borders)
- `button-style`: Primary buttons use purple gradient with hover-lift effect
- `input-style`: Inputs use dark semi-transparent backgrounds with purple focus rings

## Impact

- `frontend/src/index.css` — Replace all `:root` CSS variables with dark palette
- `frontend/src/App.css` — Update app shell, buttons, inputs, badges, cards, spinner
- `frontend/src/pages/LandingPage.css` — Dark backgrounds, glass cards, purple accents
- `frontend/src/pages/UploadPage.css` — Dark form, glass overlay, updated progress bar
- `frontend/src/pages/ReviewPage.css` — Dark stats bar, source panel, toolbar
- `frontend/src/pages/FinalizedPage.css` — Dark meta bar, entity tables, JSON preview
- `frontend/src/components/EntityCard.css` — Dark table, glass card, purple toggles
- `frontend/src/components/FileUploader.css` — Dark drop zone with purple corners
- `frontend/src/components/TenantInfo.css` — Dark text/borders
- `frontend/src/components/ModelSelector.css` — Dark select styling
- No changes to JSX/TSX files — this is purely CSS
