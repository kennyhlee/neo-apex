## 1. Foundation — Font and CSS Variables

- [ ] 1.1 Update Google Fonts import in `index.html` from DM Mono/DM Sans to Inter (weights 400, 500, 600, 700, 800)
- [ ] 1.2 Replace `:root` CSS variables in `index.css` — colors, fonts, radii, shadows per design.md mapping table
- [ ] 1.3 Add Floatify tinted background pairs to `:root` (--tint-blue-bg/text, --tint-pink-bg/text, --tint-green-bg/text, --tint-amber-bg/text)
- [ ] 1.4 Update base font size to 16px on `html`, set `font-family: 'Inter'` on body
- [ ] 1.5 Remove body background texture overlay (fractal noise pseudo-element) and set `background: var(--bg-primary)`
- [ ] 1.6 Update `--font-mono` variable to point to Inter (or remove and replace all `var(--font-mono)` references with `var(--font-sans)`)
- [ ] 1.7 Update scrollbar styling for light theme or remove custom scrollbar rules

## 2. Global Components — App.css

- [ ] 2.1 Update app header: light background, dark text, accent-colored logo (remove gradient shimmer)
- [ ] 2.2 Update `.btn--primary`: solid blue background (#378ADD), white text, blue glow shadow on hover, translateY(-2px) lift
- [ ] 2.3 Update `.btn--danger`: use pink accent (#D4537E) with matching hover
- [ ] 2.4 Update input/select styles: white background, #E2E8F0 border, blue focus ring
- [ ] 2.5 Update `.badge--base` and `.badge--custom` to use tinted background pairs (blue for base, green for custom)
- [ ] 2.6 Update card base styles: white background, 1px solid #E2E8F0 border, soft shadow, remove backdrop-filter
- [ ] 2.7 Update page header styles (eyebrow, title, description) for dark text on light background
- [ ] 2.8 Increase heading font sizes (h1: 28px+, h2: 22px+, h3: 18px+), set weight 700-800, letter-spacing -0.02em

## 3. Component Styles

- [ ] 3.1 Update `EntityCard.css`: white card background, dark text, light borders on table rows, update hover states
- [ ] 3.2 Update EntityCard toggle switch colors for light theme
- [ ] 3.3 Update EntityCard options editor (tag styling) to use tinted backgrounds instead of rgba overlays
- [ ] 3.4 Update `TenantInfo.css`: dark text, light background, adjust tenant marker color
- [ ] 3.5 Update `FileUploader.css`: light dashed border, remove accent corner bracket decorations or restyle for light theme, update active/hover states
- [ ] 3.6 Update `ModelSelector.css`: ensure select matches new input styling

## 4. Page Styles

- [ ] 4.1 Update `LoginPage.css`: white/light background, remove dark radial gradient glows, blue accent button, white glass card with subtle shadow
- [ ] 4.2 Update `LandingPage.css`: light model card, light action cards, dark text, update status indicator colors
- [ ] 4.3 Update `UploadPage.css`: light error banner, light progress bar, light confirmation modal overlay
- [ ] 4.4 Update `ReviewPage.css`: light source panel background, update stats bar and toolbar for light theme
- [ ] 4.5 Update `FinalizedPage.css`: light confirmation banner, light entity summary tables, update column headers and type badges

## 5. Hardcoded Colors and Cleanup

- [ ] 5.1 Remap `TYPE_COLORS` in `EntityCard.tsx` to Floatify palette per design.md decision 6
- [ ] 5.2 Grep remaining TSX files for inline hex/rgba color values and replace with CSS variables
- [ ] 5.3 Remove unused dark-theme-specific CSS rules (gradient-text shimmer keyframes, dark rgba overrides)
- [ ] 5.4 Verify all text meets WCAG AA contrast on new light backgrounds

## 6. Visual Verification

- [ ] 6.1 Walk through Login → Landing → Upload → Review → Finalize flow and verify no dark remnants
- [ ] 6.2 Verify no backdrop-filter or glassmorphism remains on any component
- [ ] 6.3 Verify minimum font size is 12px on all labels/metadata
- [ ] 6.4 Verify body text line-height is 1.5+
