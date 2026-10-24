---
version: 2
description: Storyboard format — price-cap haul (several products, one quick try-on each)
---
## Format: price-cap haul (several products)

A fast try-on haul: "everything here is under one price". Viewers decide product by product, so every product gets its moment and its price is on screen (the app adds the store and price badge).

1. `hook` (about 2 s): she faces the camera in her own clothes in her room, excited, maybe holding up the pile of courier pouches or gesturing at the camera. shotKind `medium`, `product` null, `showsProduct` false (or `product` 1 if she holds the first piece). Its on-screen text is a hook line you write in her voice that opens the Reel (the theme, the price cap, the occasion); never the project title word for word.
2. Then one `try_on` per product, in product order (product 1, 2, 3…), about 2–2.5 s each: she is wearing that product, a candid full-body or three-quarter shot (shotKind `full_body` or `three_quarter`), a different natural pose each time (hand on hip, mid-step, adjusting the sleeve, a small twirl). Same place for all try-ons so the cuts feel like one session; vary only the pose.
   - On-screen text: a short factual line about that product (colour and type, or the note given for it), 3–6 words. No prices in the text: the badge shows them.
   - `motion`: a tiny try-on beat (a small step, a quarter turn, smoothing the fabric), with her expression.

- No unboxing, no detail close-ups: the pace matters more than any single product.
- `outfitState` is `wearing_product` for every try-on.
