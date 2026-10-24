# Story formats and multi-product projects

A project picks a **format** when it is created. The format decides how many products it holds, which scene types the storyboard uses, and how the Reel is assembled. Everything after the storyboard (images, videos, compose, export) works scene by scene, so most of the pipeline is shared.

| Format | Key | Products | Scenes (in order) | Reel length |
|---|---|---|---|---|
| Classic | `classic` | 1 | unboxing, hold_up, pieces, detail, wearing_front, wearing_alt (adapted) | 16–20 s |
| Price-cap haul | `haul` | 2–5 | hook, then one `try_on` per product | 10–20 s |
| Occasion edit | `occasion` | 2–5 | hook, then one `try_on` per product | 10–20 s |
| Outfit transition | `transition` | 1–3 | optional hook, then per product `transition_before` + `transition_after` | 10–20 s |
| One piece, 3 ways | `three_ways` | 1 | hook (holding it up), then 3 `styled` scenes | 14–20 s |

A 2–4 s CTA end card follows in every format. The ranges include it.

## Data model

- **Project**: `format`, `title` (the project's name: "Kurtis under ₹499", "3 Diwali looks"; for classic it is the product title; never shown in the Reel), `occasion`, influencer, status. No product fields any more.
- **Product** (ordered, 1..N per project): title, store (`sourceId`), price and price-mode override, product URL, affiliate link, a short `note` shown on screen in hauls (e.g. "Cotton, 3 colours"). Has its own **ProductImage**s and **ProductSpec** (analysis, must-match list, garment paragraph).
- **Scene**: `productId` (which product it shows; null for a hook that shows none). Prompts, attachments, reviews and badges all use the scene's product.
- **VideoJob**: `endAssetId` for transitions (Kling start + end frame).

Existing projects migrate to `format = classic` with one product carrying their old fields.

## Scene types

| Type | Outfit | Product | Notes |
|---|---|---|---|
| `hook` | own clothes, or wearing product 1 | none or product 1 | Opens a multi-product Reel; its on-screen text is a generated hook line (not the project title). No badge. |
| `try_on` | wearing | that product | 2–3 s, full body or three-quarter, candid. Badge with that product's price; the on-screen text is a short line about it. |
| `styled` | wearing | the product | Same piece styled for a different occasion (accessories, setting, drape). Garment unchanged. |
| `transition_before` | own clothes | that product (for reference) | Image only: the start frame of the next scene's video. No segment of its own. |
| `transition_after` | wearing | that product | Same pose, framing and background as the before image. Video = Kling start frame (before) → end frame (after) with a quick spin or hand-across-lens move. |

## Pipeline changes

- **Analysis** runs per product (one job each); the analysis page has a tab per product.
- **Storyboard** gets every product's spec and paragraph, numbered; scenes carry `product` (1..N or null). Format rules are checked in code (one `try_on` per product, pairs in order, counts, durations).
- **Image prompts** use the scene's product: its garment paragraph, its photos. A `transition_after` scene also attaches the approved `transition_before` image as the pose reference.
- **Videos**: single-scene only for the new formats. `transition_before` scenes get no video job; `transition_after` jobs attach start + end frames and use the transition prompt.
- **Compose**: the badge on each segment shows that segment's product (store logo + price). Hooks never get a badge. Each scene has its own on-screen text switch (off: no text over the outfit), plus one for all scenes.
- **Captions**: hauls list every product with its price; the LINK DM lists every link, numbered; disclosure lines are the union of the stores'.
- **QA**: the Reel-length check uses the format's range.
