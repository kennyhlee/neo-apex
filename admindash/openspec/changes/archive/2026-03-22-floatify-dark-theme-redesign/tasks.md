## 1. Global Foundation

- [ ] 1.1 Overhaul CSS variables in `index.css` — replace all color, shadow, and radius tokens with dark Floatify palette (keep DM Sans / DM Mono fonts)
- [ ] 1.2 Update body/html base styles in `index.css` — dark background, remove warm noise texture, add radial gradient decorations
- [ ] 1.3 Add `.gradient-text` utility class and update global element resets (links, scrollbar, selection) for dark theme

## 2. App Shell & Navigation

- [ ] 2.1 Update `App.css` — dark background on app shell
- [ ] 2.2 Update `Navbar.css` — glassmorphism navbar (backdrop blur, transparent bg, keep 56px height, dark nav links)
- [ ] 2.3 Update `Navbar.tsx` — add `gradient-text` class to brand text
- [ ] 2.4 Update `Footer.css` — dark footer with muted text

## 3. Component Styles

- [ ] 3.1 Update `DataTable.css` — glass card wrapper, opaque dark table cells for readability, dark header, purple-tinted row hover, gradient pagination buttons
- [ ] 3.2 Update `FilterForm.css` — opaque dark inputs with purple focus states, gradient primary button
- [ ] 3.3 Verify `StatusBadge.tsx` — confirm CSS variable updates provide correct dark-theme badge colors (update if needed)

## 4. Page Styles

- [ ] 4.1 Update `LoginPage.css` — glassmorphism login card, dark background, gradient submit button
- [ ] 4.2 Update `HomePage.css` — gradient stat cards, dark glass content cards, dark schedule items
- [ ] 4.3 Update `StudentsPage.css`, `LeadPage.css`, `ProgramPage.css` — dark page-level styles
- [ ] 4.4 Add `gradient-text` class to H1 headings in page TSX files (HomePage, StudentsPage, LeadPage, ProgramPage)

## 5. Verification

- [ ] 5.1 Run the dev server and visually verify all pages render correctly with the dark theme
- [ ] 5.2 Check that data tables and form inputs have comfortable readability on dark backgrounds
- [ ] 5.3 Verify status badges are readable with sufficient contrast on dark surfaces
