# Trademark Terminal brand kit

Trademark Terminal uses one logo treatment: the acid-chartreuse prompt mark on near-black. Dark interfaces may place the transparent mark directly on the page. Light interfaces use the protected dark-field asset; do not create an inverted light-mode mark.

The full lockup sets the word `TRADEMARK` in heavy Archivo beside the mark, so the mark reads as the second word of the name.

## Assets

| File | Use |
| --- | --- |
| `github-header.png` | 4:1 repository and social header |
| `terminal-mark.svg` | Canonical scalable mark on dark surfaces |
| `terminal-mark.png` | 1024 px transparent raster mark |
| `terminal-mark-dark-field.png` | 1024 px protected treatment for light surfaces |
| `app-icon-512.png` | Large application icon |
| `app-icon-192.png` | Web application icon |
| `favicon-64.png` | High-density browser icon |
| `favicon-32.png` | Standard browser icon |
| `brand.css` | Shared color and typography tokens |

The website serves the browser and application icons from `apps/web/public`, which
symlinks the files above. Regenerating an icon here updates the website with it.

## Rules

- Keep the mark acid chartreuse (`#D7F52A`).
- Place the transparent mark only on near-black (`#151616`) or an equivalently dark neutral.
- On light or photographic surfaces, use the protected dark-field asset.
- Preserve the square frame, stroke weight, and the prompt's baseline alignment.
- Do not invert, recolor, rotate, crop, add effects, fill the frame, or redraw the mark.
- Keep clear space of at least one eighth of the mark width on every side.
- Use at 32 px or larger so the chevron and cursor stay separable.

The mark is a logomark, not a UI mascot. It does not appear as decorative empty-state art, animation, or product illustration.

## Visual system

- Primary: `#D7F52A`
- Near-black: `#151616`
- Warm off-white: `#F5F2EA`
- Typeface: Archivo Variable
- Display: heavy condensed Archivo
- Interface copy: Archivo 400–600
