# Contributing

The two things most worth contributing are **themes** and **narratives**.
Neither requires touching core code, and both are the parts of the project
that benefit most from other people's taste.

```bash
git clone https://github.com/madelacruzs/carousel-forge
cd carousel-forge
npm install
npx playwright install chromium
npm run build
npm test
```

`npm run build` compiles to `dist/`. Run the CLI during development with
`node dist/cli.js <command>`.

---

## Contributing a theme

A theme is a directory of four files. **If you find yourself needing to edit
anything under `src/` to make your theme work, that is a bug in core — open an
issue instead of working around it.**

### 1. Start from one that already works

```bash
node dist/cli.js themes new my-theme --from warm-editorial
```

Built-in themes live in `themes/`. A `themes/` directory inside a user's
project shadows the built-ins by name, which is also how forking works.

### 2. What the files do

```
themes/my-theme/
  theme.json      # tokens, canvas, safe area, declared slots, layouts
  template.html   # Handlebars, escaped by default
  theme.css       # all of the design
  fonts/          # optional, woff2 named Family-700italic.woff2
  preview.png     # generated, see below
```

**`theme.json`** declares your tokens and which layouts you support. Declare
`default` plus as many of `hook`, `value`, `quote`, `split`, `cta` as you want
— a layout a narrative asks for but you do not declare falls back to
`default`, so your theme works with every narrative from day one. Decide
consciously which ones deserve a real design.

Only list Google Fonts in `fonts`; they are downloaded into a local cache at
build time. **Never commit a licensed commercial font.** Theme-owned `.woff2`
files are fine if you have the right to redistribute them.

**`template.html`** receives the frame context documented in the README.
Two rules:

- Mark every element the reader reads with `data-slot="title"` and friends.
  That attribute is the only way `doctor` can measure your theme, and it is
  what keeps the linter theme-agnostic.
- Put no styling in the template. Classes and structure only.

**`theme.css`** may read the token custom properties plus the ones core
provides: `--canvas-w`, `--canvas-h`, `--safe-top/right/bottom/left`,
`--overlay-strength`, `--image`, `--image-b`, and the luminance measurements
`--lum-top/mid/bottom/all`, `--lum-rNcN`, `--lum-vNcN` and their `--lum-b-*`
twins for the second photo of a `split`. The layout and narrative role
arrive as classes on `<body>` (`.layout-cta`, `.role-hook`), so variants are
descendant selectors.

Core measures the photograph; the theme decides what to do about it. If you
add a threshold or a curve to core to make your theme look right, that is a
bug — put it in your `theme.css` instead. See "Adapting to the photograph"
in the README for the properties and two traps worth knowing about.

Do not hardcode a colour, a font family or a size that a user might reasonably
want to change — make it a token. Tokens are what `brand:` in `carousel.yaml`
overrides.

### 3. Look at it

Render it, do not reason about it:

```bash
cd /tmp && node /path/to/carousel-forge/dist/cli.js init --theme my-theme
node /path/to/carousel-forge/dist/cli.js build
node /path/to/carousel-forge/dist/cli.js doctor
```

Open the PNGs. Then open `out/contact-sheet.png` — that is roughly what
someone sees in the feed, and it is where a too-small title or a weak hook
slide becomes obvious.

`doctor` must be clean. If it flags something you believe is correct, say so
in the PR rather than tuning around it; the thresholds are shared by every
theme and we would rather fix them properly.

### 4. Check the hard cases

A theme is not done until these all look right:

- A three-line title and a one-word title.
- A slide with no photo.
- The `cta` layout, which usually has no photo at all.
- The `split` layout with `imageB`, `labelA` and `labelB`.
- A long `handle` and a missing `logo`.
- All three of `viral-5`, `story-arc` and `before-after`.
- **Real photographs, not test gradients.** A flat gradient is the one case
  every overlay survives. Render over a blown-out window, a mostly-white
  interior, a busy patterned surface and a very dark night shot before you
  believe the theme works. `tests/hard-photo.test.ts` keeps a synthetic
  version of this honest, but it is not a substitute for looking.

### 5. Generate the preview

```bash
node scripts/build-previews.mjs
```

This writes `themes/<name>/preview.png` using the real pipeline. Add your
theme to the catalog in the README with a one- or two-sentence description of
what it is _for_, not what it looks like.

---

## Contributing a narrative

A narrative is one YAML file describing what gets said and in what order. It
must not mention a theme, a colour or a font.

```bash
node dist/cli.js narratives new my-story --from viral-5
```

Each role carries:

- **`purpose`** — what this slide does for the reader, in one line.
- **`tone`** — real guidance for whoever writes the copy. This is the most
  valuable field in the file; write it like a note to a junior copywriter, not
  like documentation. "Blunt and specific. No throat-clearing." beats "should
  be engaging."
- **`example`** — a concrete line that shows the tone rather than describing
  it.
- **`copy`** — word and line budgets per slot. Budgets should reflect what
  actually fits and what actually gets read, so test them against a real
  render.
- **`repeat`** and **`anchor: end`** — how the structure stretches to fit a
  slide count.

Check that it stretches:

```bash
node dist/cli.js narratives list --verbose
```

Then build the same narrative at its minimum and maximum slide counts, against
at least two different themes, and run `doctor`.

### Hook formulas

New formulas go in `narratives/hooks.yaml`. Each needs a `pattern` with
`{placeholders}`, an `example` that actually matches its own pattern (a test
asserts this), `works_for`, and `notes` explaining _why_ it works. A formula
without a reason is just a template.

---

## Core changes

Core is deliberately small and deliberately dumb.

- **Core owns no design.** Structure and custom properties only.
- **Core never writes copy.** `caption.md` is an empty form; `doctor` reports
  and explains but never rewrites. Machine-written marketing copy is the thing
  this project exists to avoid.
- **Determinism is a feature.** Identical inputs must produce byte-identical
  PNGs. `tests/determinism.test.ts` enforces this; do not introduce
  timestamps, randomness, locale-dependent formatting, or browser-side image
  resampling.
- **The unit of render is a `Frame`** — a slide plus a time `t` — so that
  video stays possible later. Export goes through `OutputTarget`. Keep both
  seams intact.

Before opening a PR:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Please add a test for anything that has a right answer: schema errors, token
precedence, crop maths, role assignment, hook matching.

## Commits and PRs

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `feat(themes):`). For
a theme or narrative PR, include the rendered contact sheet — reviewing a
design from a diff is not possible.

## License

Contributions are MIT, matching the project.
