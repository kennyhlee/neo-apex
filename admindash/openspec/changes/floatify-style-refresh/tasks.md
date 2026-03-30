## 1. Foundation — Font and CSS Variables

- [ ] 1.1 Update Google Fonts import in `index.html` from DM Mono/DM Sans to Inter (weights 400, 500, 600, 700, 800)
- [ ] 1.2 Replace all `:root` CSS variables in `index.css` — colors, fonts, radii, shadows per design.md mapping table
- [ ] 1.3 Add Floatify tinted background pairs to `:root` (`--tint-blue-bg/text`, `--tint-pink-bg/text`, `--tint-green-bg/text`, `--tint-amber-bg/text`)
- [ ] 1.4 Update html base font size to 16px, set `font-family: 'Inter'` on body, line-height 1.6
- [ ] 1.5 Remove body `::before` background decorative gradients and set `background: var(--bg-primary)` as solid color
- [ ] 1.6 Update `--font-mono` and `--font-sans` variables to both point to Inter
- [ ] 1.7 Remove `.gradient-text` utility class from `index.css`
- [ ] 1.8 Update scrollbar styling for light theme or remove custom scrollbar rules
- [ ] 1.9 Update global selection (`::selection`) colors for light theme

## 2. Global Components — App.css

- [ ] 2.1 Update `.btn--primary` or equivalent: solid blue background (#378ADD), white text, blue glow shadow on hover, translateY(-2px) lift
- [ ] 2.2 Update `.btn--danger` or equivalent: pink accent (#D4537E) with matching hover
- [ ] 2.3 Update card base styles: white background, 1px solid #E2E8F0 border, soft shadow, remove backdrop-filter/glassmorphism
- [ ] 2.4 Update page heading styles for dark text on light background — font-size 28px+, weight 700-800, letter-spacing -0.02em

## 3. Navbar — Navbar.css and Navbar.tsx

- [ ] 3.1 Update navbar background to light/white, add bottom border `1px solid #E2E8F0`, remove backdrop-filter
- [ ] 3.2 Update nav link colors: dark text default, accent-blue on active/hover
- [ ] 3.3 Update brand text to use `color: #378ADD` instead of gradient-text class (update Navbar.tsx to remove gradient-text className)
- [ ] 3.4 Update logout button styling for light theme

## 4. Data Table — DataTable.css

- [ ] 4.1 Update table wrapper: white card with border and soft shadow, remove glassmorphism
- [ ] 4.2 Update table header: `#F1F5F9` background, uppercase 12px labels in `#A0AEC0`, letter-spacing 0.05em
- [ ] 4.3 Update table row backgrounds to white, hover to `rgba(55,138,221,0.06)`
- [ ] 4.4 Update table borders to `#EDF2F7`
- [ ] 4.5 Update pagination: active button solid blue (#378ADD), other buttons light theme styling

## 5. Filter Form — FilterForm.css

- [ ] 5.1 Update filter card: white background, subtle border and shadow, remove glassmorphism
- [ ] 5.2 Update input/select styles: white background, #E2E8F0 border, blue focus ring
- [ ] 5.3 Update filter labels to dark text, minimum 12px font-size
- [ ] 5.4 Update primary/secondary button variants for light theme

## 6. Page Styles

- [ ] 6.1 Update `LoginPage.css`: white card on light background, border-radius 20px, soft shadow, blue accent button, optional subtle radial glow decorations
- [ ] 6.2 Update `HomePage.css`: replace gradient stat pills with tinted color pairs on white cards, dark text headings, update schedule event colors for light backgrounds
- [ ] 6.3 Update `StudentsPage.css`: toolbar buttons to solid blue, dark text headings, remove gradient-text usage
- [ ] 6.4 Update `LeadPage.css` and `ProgramPage.css`: dark text on light backgrounds, update placeholder page styling
- [ ] 6.5 Remove `.gradient-text` class usage from all page component TSX files (HomePage.tsx, StudentsPage.tsx, etc.)

## 7. Component Styles

- [ ] 7.1 Update `StatusBadge.tsx` inline colors: remap all status colors to tinted pairs per design.md decision 6
- [ ] 7.2 Update `Footer.css`: light background, dark muted text, top border `1px solid #E2E8F0`
- [ ] 7.3 Update any remaining component CSS files for light theme consistency

## 8. Cleanup and Verification

- [ ] 8.1 Grep all TSX files for inline hex/rgba color values and replace with CSS variables where possible
- [ ] 8.2 Remove unused dark-theme-specific CSS rules (gradient-text keyframes, dark rgba overrides, purple glow shadows)
- [ ] 8.3 Verify all text meets WCAG AA contrast on light backgrounds
- [ ] 8.4 Walk through Login → Home → Students → Leads → Programs flow and verify no dark remnants
- [ ] 8.5 Verify no backdrop-filter or glassmorphism remains on any component
- [ ] 8.6 Verify minimum font size is 12px on all labels/metadata
- [ ] 8.7 Verify body text line-height is 1.5+
