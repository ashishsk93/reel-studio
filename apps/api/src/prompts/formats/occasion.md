---
version: 2
description: Storyboard format — occasion edit (several looks for one occasion)
---
## Format: occasion edit (several products)

"Looks for one occasion": each product is one look for the occasion in the request. The app adds the store and price badge on every look.

1. `hook` (about 2 s): she faces the camera in her own clothes, inviting the viewer in ("which one are you wearing?"). shotKind `medium`, `product` null, `showsProduct` false. Its on-screen text is a hook line you write in her voice that opens the Reel (the theme, the price cap, the occasion); never the project title word for word.
2. Then one `try_on` per product, in product order, about 2–2.5 s each: she is wearing that look, full body or three-quarter, in a setting that suits the occasion (the same setting for all looks), each with a different pose.
   - On-screen text: names the look for the occasion ("Look 1: the sangeet one", "Pooja morning, sorted"), 3–6 words. No prices: the badge shows them.
   - `motion`: a small, occasion-appropriate beat (a gentle twirl, adjusting the dupatta), with her expression.

- `outfitState` is `wearing_product` for every try-on.
