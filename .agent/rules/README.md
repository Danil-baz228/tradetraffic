# Agent Rules

This directory contains mandatory rules for all AI agents working in this repo.

## Files

- **design-screens.md** — Global Pencil -> Unity design workflow rules for this repo. Based on the reverse-engineering PDF and `d2-palletemaker/design.pen`.

## Key Principles

1. **`1125 x 2436` stays the portrait baseline** — this is still the default canvas for repo-wide designs.
2. **Screen shells stay absolute** — use `layout: "none"` for the outer screen shell and exact-placement blocks.
3. **Explicit flex is allowed** — use `layout: "horizontal"` or `layout: "vertical"` intentionally for rows and columns.
4. **No implicit layout defaults in critical containers** — always declare layout explicitly where import behavior matters.
5. **`fill_container` and `fit_content(...)` are valid tools** — use them intentionally in layout containers and reusable components.
6. **Text width/height is conditional** — require it only when wrapping or fixed text boxes are needed.
7. **d2 is the practical repo reference** — reuse its shell, gutter, status bar hierarchy, component model, and token style.

## Status Bar Reference

The reusable top bar references are in `.agent/refs/topbars/`, but the primary repo convention is now the reusable d2-style status bar hierarchy documented in `design-screens.md`.
