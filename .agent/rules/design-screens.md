# Pencil -> Unity Design Rules

> **MANDATORY** for every `.pen` design in this repo.
> This replaces the older d3-only rule set.
> Baseline sources: `Reverse-engineering .pen files for Unity screen generation.pdf` and `d2-palletemaker/design.pen`.

---

## 1. Analysis Summary

The old rules were too strict for real Pencil files and for the repo's working reference design.

What the PDF confirms:

- A `.pen` file is a JSON object tree with `version`, `children`, and usually `variables`.
- Pencil supports both absolute layout and flex-like layout.
- Under flex layout, child `x` and `y` are ignored.
- `fill_container` and `fit_content(...)` are valid sizing tools.
- Text does not need numeric `width` and `height` unless wrapping or a fixed text box is required.
- Reusable components, `ref` instances, `descendants` overrides, variables, and slots are first-class parts of the format.

What d2 proves in this repo:

- The portrait screen shell is stable and Unity-friendly.
- One status bar, one clear header band, and one main content column are easier to import than ad hoc nesting.
- Reusable components plus tokenized styling create cleaner files than copy/pasted UI.
- A practical Pencil workflow here is: absolute screen shell, explicit flex only where rows or columns really need it.

Repo-wide standard:

- The portrait artboard / canvas baseline stays `1125 x 2436`.
- Landscape is allowed only for intentionally landscape products and must use `2436 x 1125`.
- Screen shells stay absolute.
- Flex is allowed and expected inside intentional row/column containers.
- Never rely on Pencil defaults in import-critical containers.

---

## 2. Root Document Shape

Every design should keep a predictable root structure:

- `version`
- `variables`
- `children`

Optional `imports` and `themes` are allowed only when they are intentional and supported by the current pipeline.

Do not add extra document-level complexity unless it is actively used.

---

## 3. Top-Level Organization

Use a repo-wide board structure based on d2:

- `00 Components` for the visible component catalog and reference blocks
- Ordered screen boards such as `01 Splash`, `02 Onboarding`, `03 Home`
- Optional modal boards when a modal needs its own full-screen board
- Optional `10 States` board for empty/loading/pro/limit states
- Reusable top-level components named `Component/<Name>`

Rules:

- Keep one naming system per file.
- In this repo, prefer d2-style ordered screen boards for actual screens.
- Reusable items that are instantiated across screens must use `Component/<Name>`.
- Do not leave default names like `Rectangle 12` or `Frame 34`.

---

## 4. Canvas and Screen Shell

### Mandatory baseline

- Portrait screen frame: `1125 x 2436`
- Landscape screen frame: `2436 x 1125` only when the product is truly landscape
- Screen frame layout: `none`
- Screen background: token-driven

### Canvas note

- If you use an internal `Canvas` child, it must stay `1125 x 2436` at `x: 0, y: 0`.
- If you follow the exact d2 shell, direct screen children are also acceptable.
- Do not add multiple wrapper frames without a real import or design reason.

### D2 shell metrics

Use these values as the default portrait shell unless a screen intentionally breaks the pattern:

- Default side gutter: `67.164`
- Default content width: `990.672`
- Status bar frame: `x: 67.164`, `y: 0`, `width: 990.672`, `height: 164.444`
- Header band start: around `y: 220.188`
- Main body blocks usually reuse the same `x` and `width`, and begin around `y: 404.142` or `y: 448.737`
- Full-screen overlays and modal veils may use `x: 0`, `y: 0`, `width: 1125`, `height: 2436`

### Shell rules

- One status bar per screen.
- One main screen shell per screen.
- No duplicate status bars hidden with opacity tricks.
- No accidental double headers.

---

## 5. Layout Rules

### Use `layout: "none"` for

- screen shells
- overlays
- hero blocks and media blocks that need exact placement
- floating badges, chips, and decorative elements
- any container where child position must map directly into Unity coordinates

### Use explicit `layout: "horizontal"` or `layout: "vertical"` for

- swatch rows
- feature lists
- button rows
- button stacks
- card meta columns
- list item internals
- crossword rows
- keyboard rows
- any importer-critical repeating row or column

### Hard rules

- Never rely on implicit Pencil layout defaults.
- Every importer-critical container must declare `layout` explicitly.
- Under `layout: "none"`, children must have explicit `x` and `y`.
- Under flex layouts, do not rely on child `x` and `y`.
- Use order, gap, padding, alignment, and size behavior to control flex placement.

---

## 6. Sizing Rules

- Screen shells and major visual blocks should use explicit numeric `width` and `height`.
- Layout containers must have deterministic sizing:
  - numeric size
  - `fill_container`
  - `fit_content(...)`
- `fill_container` is allowed inside components and layout containers when used intentionally.
- `fit_content(...)` is allowed when the container truly sizes to its children.
- Do not create circular sizing such as parent `fit_content(...)` combined with child `fill_container` in a way that cannot resolve cleanly.

### Text sizing

- Text does not need numeric `width` and `height` by default.
- If text needs wrapping or a fixed text box, set `textGrowth` first.
- After that, size the text box intentionally.

This is a required change from the old rules. Numeric width/height is not mandatory for every text node.

---

## 7. D2 Hierarchy Standard

Target structure for most portrait screens:

```text
Screen Frame (1125x2436, layout: none, token background)
  statusBar
  Header / Top section
  Main content blocks
  Primary CTA / Secondary actions / Footer text
  Overlay only when needed
```

### Status bar hierarchy

Use one reusable status bar structure based on d2:

```text
statusBar
  Left
    Time
  Center
    DynamicIsland
  Right
    Signal
    Wifi
    Battery
```

### Media hierarchy

- Keep image-like content inside named frames such as `Thumb`, `Photo`, `Hero`, or `Banner`.
- Put tags, chips, and badges inside that media frame as children.
- Give media containers explicit size, clipping, and radius behavior.
- Do not scatter media metadata or overlays across unrelated sibling nodes.

### Section rhythm

Prefer the d2 rhythm:

- shell
- header
- primary content
- secondary content
- CTA
- supporting action row or footer text

---

## 8. Components, Refs, and Slots

Rules for reusable UI:

- Every reusable source must be marked `reusable: true`.
- Every instance must use `type: "ref"` with a valid `ref`.
- Customize instances with `descendants`, not copy/paste duplication.
- Treat internal component ids as a public contract.
- If you rename or recreate internal nodes, update every override path accordingly.

For container-like reusable pieces:

- Prefer a clear content-holder frame.
- Use `slot` when the workflow or importer benefits from structured insertion.

### Reusable set modeled on d2

Prefer a shared library close to this set:

- `Component/StatusBar`
- `Component/TopBar`
- `Component/PrimaryCTA`
- `Component/SwatchTile`
- `Component/SwatchRow`
- `Component/PalettePreviewCard`
- `Component/ListItem`
- `Component/ModalBase`
- `Component/Toast`

---

## 9. Tokens and Naming

Every file should define one clear variable set and use it consistently.

Prefer d2-style semantic tokens over raw values, for example:

- `background`
- `card`
- `card_surface`
- `foreground`
- `text_primary`
- `text_secondary`
- `text_tertiary`
- `border`
- `primary`
- `secondary`
- `font-primary`
- `font-secondary`
- `radius_*`

Rules:

- Use variables instead of raw hex values wherever practical.
- Use variables for fonts and radii too, not just colors.
- Internal node names should be semantic and stable.
- d2-style prefixed ids are preferred for internals, for example `hmMain`, `pwBody`, `rsPhotoTagText`.

---

## 10. Icons, Images, and Advanced Fills

- Icons should use `icon_font` with a known icon family.
- Image or gradient blocks must be explicit named containers.
- If a screen uses gradients, alpha fills, or image fills, keep them isolated in a frame that can be mapped or intentionally ignored by the importer.
- Do not bury important interactive content inside decorative image structures.

If a source image requires attribution metadata, keep it in the file, but keep the visible hierarchy clean and import-oriented.

---

## 11. States, Hidden Content, and Modals

- Use `10 States` for exploratory or reusable state boards.
- Avoid `enabled: false` in production-ready UI unless the importer explicitly supports it.
- Do not keep duplicate shell elements and hide them with opacity unless that behavior is intentional and supported.
- Modal overlays should be either:
  - a full-screen alpha fill
  - a reusable overlay / modal component

Hidden or disabled content should never be required for a screen to look correct after import.

---

## 12. What Is No Longer Globally Banned

These are allowed when intentional and when the importer contract supports them:

- `layout: "horizontal"`
- `layout: "vertical"`
- `fill_container`
- `fit_content(...)`
- text without numeric `width` and `height`

Still not acceptable:

- implicit layout in importer-critical containers
- copy/pasted repeated UI instead of `ref`
- duplicate status bars
- hidden dependency on disabled layers
- random unnamed rectangles and frames

---

## 13. Unity Import Checklist

Before a `.pen` file is considered ready:

- [ ] Portrait baseline remains `1125 x 2436`, unless the design is intentionally landscape
- [ ] Screen shell uses `layout: "none"`
- [ ] Import-critical rows and columns declare `layout` explicitly
- [ ] Every absolute child has explicit `x` and `y`
- [ ] Every flex container has deterministic sizing
- [ ] Child order matches intended draw order
- [ ] Wrapped text uses `textGrowth`
- [ ] Repeated UI is built from `ref` instances
- [ ] One status bar only
- [ ] Tokens are used for colors, fonts, and radii
- [ ] Media containers are clearly named and structurally isolated
- [ ] No importer-critical behavior depends on implicit defaults
