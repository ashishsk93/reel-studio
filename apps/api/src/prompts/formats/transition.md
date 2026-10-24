---
version: 2
description: Storyboard format — outfit transition (own clothes to the product, Kling start and end frames)
---
## Format: outfit transition (one to three products)

The classic "outfit change" Reel: she is in her own clothes, does a quick move, and is suddenly wearing the product. Each transition is two stills that the video model joins (start frame, end frame).

1. Optional `hook` (about 2 s) first, own clothes, `product` null. Its on-screen text is a hook line you write in her voice that opens the Reel (the theme, the price cap, the occasion); never the project title word for word.
2. Then for each product, in order, a pair:
   - `transition_before`: her own clothes, in a clear pose that a quick move can come out of (hands about to sweep across the camera, mid-spin start, holding the folded product toward the lens). `product` = that product, `showsProduct` false unless she holds it, `outfitState` `own_clothes`. Its on-screen text is ignored; use "" if you like.
   - `transition_after`: immediately after it, the same place, framing, camera position and pose as the before still, now wearing that product. `outfitState` `wearing_product`. About 2.5–3 s. Its on-screen text is a short line about the outfit. Its `motion` describes the transition move: "she sweeps her hand across the lens and the outfit changes as her hand passes; she ends smiling at the camera" or "a quick spin, and she lands in the new outfit".
   - Give the pair exactly the same `setting` and `place`, and write the after description so that only the outfit differs.
- Full body or three-quarter framing for both stills (shotKind `full_body` or `three_quarter`), so the outfit change reads clearly.
