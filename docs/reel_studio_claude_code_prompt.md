# Build "Reel Studio": an AI-assisted pipeline for fashion affiliate Reels

You are building a production-quality, single-user web app that I will run locally. It turns product photos of a dress into a finished, upload-ready Instagram Reel featuring one of my AI fashion characters ("influencers").

Image and video generation happen manually on Higgsfield. The app's job is to:
- write copy-paste-ready prompts,
- tell me exactly which images to attach,
- review what I generate,
- write all the text,
- place overlays,
- assemble the final video with FFmpeg.

The Claude API (Haiku) does all the AI reasoning and vision work.

Read this whole brief before writing code. Then propose the folder structure and data model and confirm them with me, and build in the phases at the end. Commit after each working phase.

---

## 1. Context you need

- **Instagram account:** @slayurbansociety (brand: "Slay Urban Society"). Fashion affiliate Reels for Indian women: festive wear, kurta sets, co-ords, dresses.
- **Products** come from **Amazon, Myntra or Meesho**. I provide the product photos, the source, the price and, optionally, the product URL and affiliate link.
- **Influencers:** AI-generated, recurring characters. Two exist now (Aanya, Meera); more will be added from the UI. Each has a library of reference images that must be attached when generating new images so the face stays consistent.
- **Generation tools (manual, outside the app):** Higgsfield. Image edits use GPT Image or Nano Banana (selectable). Video uses Kling 3.0 image-to-video at 720p with sound off, which costs about 6.25 credits per 5 s.
- **Reel format that works for us** (default storyboard, editable per project), total about 16–20 s including the CTA:
  1. Unboxing: the influencer holds a clear courier pouch with the folded outfit.
  2. The influencer holds the main piece up against herself.
  3. The influencer shows the other piece(s) of the set (pants or dupatta) or the outfit laid out on a bed.
  4. Detail close-up: embroidery or beadwork, with her hand touching it.
  5. Wearing it: front, full body, "photographed by a friend" candid style.
  6. Wearing it: alternate angle (twirl, three-quarter, or back view if the product has a notable back).
  7. CTA end segment, 2–4 s: "Comment LINK and I'll DM you the link 👇".

## 2. Tech stack (my background is Node, NestJS and TypeScript)

- **Monorepo** with pnpm workspaces:
  - `apps/api`: **NestJS** (TypeScript, strict)
  - `apps/web`: **Next.js** (App Router), **Tailwind**, **shadcn/ui**, **TanStack Query**
  - `packages/shared`: **zod** schemas and shared types, used by both apps
- **Database:** SQLite through **Prisma** (single user, local). Keep the schema Postgres-compatible.
- **File storage:** local folder `DATA_DIR` (default `./data`) with a clear per-project layout. Store relative paths in the DB.
- **Background jobs:** a persistent jobs table plus an in-process worker (no Redis). Use it for LLM calls, FFmpeg renders and frame extraction. Push progress to the UI over **Server-Sent Events**.
- **Claude API:** `@anthropic-ai/sdk`.
- **FFmpeg / ffprobe:** called with `child_process.spawn` through a typed command-builder module, not string concatenation. Log every command.
- **Text and badge overlays:** rendered to transparent PNGs with **@napi-rs/canvas**, using a bold display font plus **Noto Color Emoji**, then composited by FFmpeg. FFmpeg `drawtext` can't render colour emoji, so don't use it for text that contains emoji. Add a unit test that renders an emoji and checks the pixels are not blank or monochrome. If colour emoji fails, strip the emoji and warn.
- **Face and subject detection for overlay placement:** run **MediaPipe Tasks Vision** (face detector plus object or pose detector) **in the browser** on sampled frames, post the bounding boxes to the API, and compute placement on the backend (see section 7). If you have a better robust local option, propose it before implementing.

### `.env`
```
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL_DEFAULT=claude-haiku-5-5
ANTHROPIC_MODEL_REVIEW=claude-haiku-5-5   # lets me switch reviews to a stronger model later
DATA_DIR=./data
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
PORT_API=4000
PORT_WEB=3000
```
Fail fast at startup with a clear message if the key or FFmpeg is missing.

## 3. Claude API usage rules

- One `LlmService` wraps every call. Model per task comes from env: default for most tasks, review model for image and video reviews.
- **Structured output:** every call that the app parses must return JSON enforced through a forced tool call (`tool_choice` set to a single tool whose `input_schema` comes from the zod schema). Validate with zod and retry up to 2 times, sending the validation error back. Check the current Anthropic docs for structured-output support and use the native feature if it's available for the model.
- **Images:** send as base64. Before sending, downscale so the long edge is at most 1568 px and re-encode to JPEG quality 85. Keep the originals on disk.
- **Video review:** the model takes images, not video. Extract frames with FFmpeg (scene midpoints, frames around each detected cut, the first and last frame, plus 2 fps sampling capped at 24 frames) and send them labelled with timestamps.
- **Prompt caching:** put the stable system prompt, persona blocks and prompt-template library first and mark them with `cache_control`.
- **Cost tracking:** log every call (task, model, input/output/cache tokens, latency, project id) to an `LlmCall` table. Show cost per project and per month in the UI, with prices configurable in settings.
- **Prompt files:** all system prompts live as versioned files in `apps/api/src/prompts/*.md`, not inline strings, so I can tune them.

## 4. Domain model (suggested; refine it)

- **Influencer:** name, slug, age, city, identity block (text), voice and personality notes, signature details, **forbidden features** (for example "no nose ring or nose piercing"), **conditional features** (for example "crescent-moon tattoo on the inside of the left wrist: only when that part of the wrist is visible in frame; never anywhere else"), default styling, active flag.
- **ReferenceImage:** belongs to an Influencer. File plus **tags** from a fixed set: `anchor`, `turnaround`, `base_front`, `base_three_quarter`, `base_walk`, `base_hair_up`, `closeup_front`, `closeup_left`, `closeup_right`, `profile`, `hands`, `lifestyle`. Plus a free-text note.
- **Source:** `amazon | myntra | meesho`. Logo file (I upload it), display name, **price display mode** (`exact | under_band | hidden`, see section 7), disclosure lines, link-generation notes.
- **Project (one Reel):** influencer, source, price (₹), product title, product URL, affiliate link, occasion or mood (for example "Diwali party"), status (state machine below), created and posted dates.
- **ProductImage:** belongs to a Project, ordered, with a role tag (`front`, `back`, `detail`, `pants`, `lifestyle`, `other`).
- **ProductSpec:** structured garment description generated by Haiku and editable (see section 5, step 2).
- **Scene:** order, type (`unboxing`, `hold_up`, `pieces`, `detail`, `wearing_front`, `wearing_alt`, `custom`), purpose, on-screen text, target duration, setting or location, the influencer's outfit in the scene (own casual clothes vs. wearing the product), the **image prompt**, **attachments list** (ordered: which reference images and which product images), and a video motion description.
- **Asset:** an uploaded generated image or video for a scene. Versioned, with status `pending_review | approved | rejected`, its Review, and its source prompt.
- **Review:** verdict (`pass | warn | fail`), scored checklist, issues (each with severity, description and an optional region), and suggested fix prompt(s).
- **VideoJob:** a group of scenes generated together in one Kling run (multi-shot mode) or a single scene (single mode). Holds the prompt, the start image, the expected shot timings, the uploaded video and detected cuts.
- **Segment:** maps a time window in an uploaded video (in/out) to a Scene. Holds the overlay placement result.
- **Render:** a final render: settings snapshot, output paths, ffprobe report, logs.
- **CaptionPackage:** Reel caption, hashtags, first comment, DM reply template, cover title, per-scene on-screen texts.
- **LlmCall, Job:** as described above.

**Project status machine:** `draft → product_analyzed → storyboard_ready → images_in_progress → images_approved → video_prompts_ready → videos_in_progress → videos_approved → composed → rendered → posted`. Allow going back to any earlier step without losing data.

## 5. The workflow (one project equals one Reel)

### Step 1: New project
A form with:
- drag-and-drop product images (multiple), with a role tag for each
- source (Amazon, Myntra or Meesho)
- price (₹)
- product title
- product URL and affiliate link (both optional)
- occasion or mood
- influencer picker: cards with each influencer's anchor image, name and city

### Step 2: Product analysis (Haiku vision)
From all the product images, generate a **ProductSpec**:
- category and garment type, and the pieces in the set (top, bottom, dupatta and so on)
- **exact colour names** (primary and secondary, plus sheen or metallic)
- fabric and transparency (sheer, lined)
- neckline (with front and back specifics), sleeves, fit and silhouette, length (with reference points such as "ankle-length")
- openings or slits, closures, waist details
- surface work: embroidery, print, beadwork or sequins. Pattern, density, motif description and placement.
- hem details, back details, and anything else distinctive
- styling seen in the listing (jewellery, footwear), as a suggestion only

It must also produce two more things:
- **"must_match" checklist:** the 6–10 attributes most likely to be got wrong or noticed by a buyer, used later in reviews.
- **"unknowns":** attributes that can't be seen in the images (for example the back, when no back image exists). Unknown attributes must never be invented in later prompts; scenes are planned to avoid showing them.

From the spec, generate a **paste-ready garment description paragraph** like the examples in section 9. Everything is editable in the UI, with "regenerate" and "save".

### Step 3: Storyboard
Haiku builds the scene list (default format from section 1, adapted to the product). For example, it skips a back view if the back is unknown, or uses a `pieces` scene only if the set has more than one piece. For each scene it produces:
- **Image prompt:** fully assembled and **copy-paste ready for Higgsfield**. No placeholders, no brackets, no "[SET]". It combines the influencer identity block, forbidden and conditional feature rules, the garment paragraph (when the product is visible), the scene description, camera style, realism instructions and aspect ratio (9:16). Use the templates in section 9 as the base patterns.
- **Attachments:** an ordered list such as *"Image 1: Aanya anchor; Image 2: Aanya base_front; Image 3: product front; Image 4: product back"*. Show thumbnails in order. Add a **"Download attachments"** button that zips the files renamed `1_aanya_anchor.jpg`, `2_product_front.jpg` and so on, so the order is unambiguous.
- **Which Higgsfield image model** to use, with a one-line reason.
- **On-screen text** (influencer's voice, 3–7 words, factual) and target duration.

**Reference image selection rules** (make these configurable):
- always attach `anchor` first
- full-body wearing shots: add `base_front`, or `base_hair_up` for halter, saree or backless outfits
- three-quarter shots: add `base_three_quarter`
- back-view shots: add `turnaround` if available
- close-ups and hand shots: `anchor` only
- product images ordered by relevance to the scene (back image only for back-view scenes)
- stay under the image tool's reference limit, which is configurable per tool

### Step 4: Images and review
For each scene I upload one or more generated images. Each upload triggers a **review** (review model) that compares the generated image against the influencer's anchor and reference images, the product images and the ProductSpec's must_match checklist. The review checks:
- **Identity:** face match, age look, hair, signature details, **forbidden features absent**, **conditional features correct** (present only when the body part is visible and in the right place)
- **Garment fidelity:** each must_match item scored match, partial or mismatch, with a note
- **Anatomy:** hands, fingers, limbs, merged fabric
- **Artefacts:** text, watermarks, logos, garbled patterns, background errors
- **Scene and composition:** does it fulfil the scene's purpose; is it framed for 9:16; is the face clear of the bottom 22% and top 13% (Instagram UI)

The output is a verdict, issues, and **fix prompts**: copy-paste-ready edit prompts for Higgsfield that name which images to attach (usually the generated image plus the relevant references) and say "change only X, keep everything else identical". I can approve one image per scene, or reject and re-upload. Show side-by-side comparisons (generated vs. product vs. anchor) in the UI.

### Step 5: Video prompts
Once all scene images are approved, generate video prompts in **two modes**. I choose per project, and can switch.

- **Multi-shot mode (default; saves credits):** group scenes into Kling 3.0 multi-shot runs of up to 15 s each. Group primarily by **shared setting and outfit state** (for example bedroom scenes with the product in her hands, then outdoor scenes wearing it), so one start image works for the group. Each VideoJob shows:
  - the start image to use (the approved image of the group's first scene) and any extra reference images if the tool supports element references (make this a tool-capability setting)
  - **one paste-ready prompt** with explicit shot markers and timings, for example `Shot 1 (0–3s): … Hard cut. Shot 2 (3–6s): …`. Each shot has a locked-off camera, subtle realistic motion, and identity and garment consistency instructions.
  - the expected shot timings, which are stored for cut matching later
  - recommended settings (720p, sound off, duration) and a credit estimate (6.25 credits per 5 s, configurable)
- **Single-scene mode (fallback):** one 5 s image-to-video prompt per scene, from that scene's approved image, with a motion line and the same consistency instructions.

Keep the multi-shot prompt format as an editable template in settings, because I'll tune it after testing how well Kling follows shot cuts.

### Step 6: Videos and review
For each VideoJob I upload the generated video. Then:
1. Run ffprobe (resolution, fps, duration, audio).
2. Detect scene cuts (FFmpeg scene-change detection, threshold configurable) and map them to the job's expected shots. If the detected cuts don't match, show the expected vs. detected timeline and let me drag the boundaries.
3. Extract frames and run a **video review**: per shot, check identity drift, forbidden features appearing, garment morphing or simplification over time, flicker, anatomy, and whether the shot matches its scene. The output is a verdict per shot, a **suggested best in/out window** per scene (target duration, avoiding the last ~0.3 s of a shot and any drifting frames), and fix suggestions (regenerate this shot alone with a single-scene prompt, or adjust the prompt).
4. Show a **timeline editor**: a video player with a scrubber, one segment per scene with draggable in/out handles, pre-filled from the suggestion, and a frame-accurate preview.

### Step 7: Compose
- **On-screen text per segment:** pre-filled from the storyboard, editable. Rendered bold white with a black stroke and soft shadow, centred horizontally, around 40% of the height, and always inside the safe zone.
- **Source logo plus price badge** on the product-showing segments (configurable which ones): the source logo, which I upload per source, and the price (for example "₹1,499") in a rounded pill. **Placement must not cover the face, hands holding the product, or the garment's key detail areas**, and must stay inside the safe zone. See section 7 for the algorithm. Always show a live preview with the badge drag-adjustable per segment.
- **CTA end segment, 2–4 s** (configurable, default 3 s): "Comment **LINK** and I'll DM you the link 👇", larger text, slight darkening, a subtle animated arrow or pulse on "LINK". Background is either a freeze of the last frame or a chosen frame, with a gentle slow zoom (configurable).
- **Cover image** (1080×1920): Haiku picks the best frame from the approved segments (face clear, outfit fully visible, expressive) and proposes 3 cover titles. I pick one. Render the cover with the title, keeping the key content inside the centre **1080×1440** area so the profile-grid crop still looks right. Export both the plain and the titled cover.
- **Caption package** (Haiku, in the influencer's voice), all editable with copy buttons:
  - Reel caption: hook line, 1–2 lines on the outfit (factual, from the spec), the CTA "Comment LINK and I'll DM you the link 👇", and **disclosure lines from the source settings**. Defaults: first line `Ad · Affiliate link`; for Amazon also add `As an Amazon Associate I earn from qualifying purchases.`
  - 5–10 hashtags: a brand tag (#SlayUrbanSociety), an influencer tag (for example #AanyaPicks), and occasion and product tags
  - first comment (optional)
  - **DM reply template** with the affiliate link inserted, in the influencer's voice, with the disclosure line
  - a "posting checklist" (mark as AI content on upload, add trending audio, share to Story, reply to comments in the first hour)

**Copy rules for all generated text:** no claims about fabric feel, fit, quality, comfort or sizing (the influencer has never touched the product). No invented discounts. No exact delivery promises. Facts only from the ProductSpec.

### Step 8: Render and export
FFmpeg final render to Instagram Reels spec:
- 1080×1920, 30 fps CFR, H.264 High, `yuv420p`, CRF 18, `-preset slow`, `+faststart`
- AAC 48 kHz stereo; a silent track by default, because I add trending audio in the Instagram app. Optional music upload with loudness normalisation to about -14 LUFS and a fade-out.
- Each segment: trim, scale to cover, centre crop, normalise fps and timebase, composite overlays. Join with the **concat filter** (re-encode).

Run automated QA and show it in the UI:
- ffprobe checks
- black-frame detection at the joins
- a contact sheet (the middle frame of each segment plus the CTA)
- total duration
- warnings, for example an emoji fallback or a badge that had to fall back to an overlapping position

The **Export** page provides `final.mp4`, `cover.jpg`, `cover_titled.jpg`, `caption.txt`, `dm_template.txt`, and a `.zip` with everything, plus an in-browser preview player. A "Mark as posted" button records the date.

## 6. Modification assistant (available on every image, video and scene)

A side panel chat attached to the current asset. I describe a change ("make the twirl less extreme", "the embroidery looks too sparse on the sleeve", "change the background to a rooftop at night"). Haiku replies with:
- a **copy-paste-ready edit prompt** for the right Higgsfield tool (image edit, or video regeneration with a single-scene prompt)
- **which images to attach, in order** (with the zip download)
- what to check afterwards

It must keep everything not mentioned identical and respect all persona rules. History is stored per asset.

## 7. Overlay placement (logo and price badge)

Inputs per segment:
- face boxes and person or garment boxes from browser-side MediaPipe on about 5 sampled frames (union over time)
- Instagram safe zone: exclude the top 13% and bottom 22% of the frame, and the right 14% in the lower half (the action buttons)
- the on-screen text box for that segment

Candidate anchors: top-left, top-right, mid-left, mid-right, lower-left above the caption zone, and lower-right.

Algorithm: score each candidate by overlap with faces (hard reject), hands and garment detail regions (heavy penalty), the person box (penalty), the text box (hard reject), and distance from the frame edge (prefer about 48 px margins). Pick the best candidate and keep the position consistent across consecutive segments where possible. If every candidate overlaps, shrink the badge to 80% and retry, then fall back to the least-overlap option with a UI warning.

Optionally, ask Haiku to sanity-check the chosen placement on the composited frame ("does the badge cover the face, hands or key garment detail?").

**Price display modes per source:**
- `exact`: "₹1,499"
- `under_band`: "Under ₹1,500", rounded up to the nearest ₹100, ₹500 or ₹1,000 depending on the price
- `hidden`: logo only

Default **Amazon = `under_band`**, because Amazon Associates restricts showing exact prices in static content; let me override it. Myntra and Meesho default to `exact`. Show the mode next to the price field.

## 8. UI and UX requirements

- **Look and feel:** clean, modern, professional. shadcn/ui components, light and dark themes, a fuchsia or rose accent colour, generous spacing, Inter for UI text, a bold display font for previews.
- **Layout:** left sidebar (Projects, Influencers, Sources and logos, Settings, Usage and costs). Each project page has a horizontal **stepper** for the 8 steps, with status badges, and each step can be revisited.
- **Prompt cards:** a monospace prompt block, a big **Copy** button, the ordered attachment thumbnails, **Download attachments (zip)**, model and settings chips, a credit estimate, and a "Regenerate prompt" button with an optional instruction box.
- **Review cards:** verdict badge, checklist with ✓, ~ or ✗, issues list, fix prompts with copy buttons, and a side-by-side image comparison with zoom.
- **Timeline editor** for videos and a **9:16 live preview canvas** showing the text, badge and CTA overlays exactly as they will render. Draggable badge.
- **Progress:** SSE-driven progress for jobs, toasts, and clear error messages with retry.
- **Influencer manager:** CRUD, a reference-image gallery with tag chips, editable identity block, voice notes, forbidden and conditional features, and a test button ("generate a sample prompt").
- **Source manager:** logo upload with a transparent PNG preview, price display mode, disclosure lines.
- Keyboard shortcuts for copy and next step. Responsive down to a laptop screen. The app doesn't need to work on mobile.

## 9. Seed data and prompt patterns (put these in seed files and prompt templates)

### Influencer: Aanya Kapoor
- Identity block:
  > Aanya Kapoor, a 22-year-old Punjabi woman from South Delhi, clearly a young adult in her early twenties. Warm light-brown skin with a fresh, dewy natural glow and realistic texture. Soft youthful face with full cheeks, high cheekbones and a gently rounded jaw, big bright dark-brown eyes with a playful, confident look, full natural eyebrows, straight nose, full lips. Voluminous dark-brown curly hair with face-framing curtain bangs, usually worn open. Small gold hoops with a stacked ear piercing. Slim build, about 5'5". Signature look: glossy cherry-red lip tint and a thin playful winged liner, otherwise light fresh makeup. Cheeky, confident grin. An original person, not a celebrity or real individual.
- Forbidden: no nose ring or nose piercing.
- Conditional: a small crescent-moon tattoo on the inside of her left wrist. Show it only if the inside of her left wrist is visible in the frame; never anywhere else.
- Voice: bold, witty, confident Hinglish, short punchy hooks. Example lines: "Beige is not a festival colour. I said what I said." and "Main character, sorted 💅". Lane: festive glam with an edge, North Indian festivals (Diwali, Karwa Chauth, Lohri, weddings). Hashtag #AanyaPicks.
- Home casual outfit for unboxing scenes: an oversized white t-shirt and grey lounge shorts. Bedroom: cosy Delhi bedroom with a cream curtain and warm fairy lights.

### Influencer: Meera Nair
- Identity block:
  > Meera Nair, a 23-year-old Malayali woman from Kochi, Kerala. Warm medium-brown skin with natural texture, oval face with a soft rounded jaw, large dark-brown almond-shaped eyes, thick natural eyebrows, small straight nose, full lips, and a small beauty mark just above the right corner of her upper lip. Long, thick, glossy black hair to mid-back, usually in a single loose braid. Small gold jhumka earrings and a thin gold chain. Slim build, about 5'4". Minimal natural makeup with a thin kajal line. Calm, warm, slightly shy expression. An original person, not a celebrity or real individual.
- Voice: warm, observant, gentle. Lane: Kerala-modern, cotton, kasavu, monsoon-friendly, Onam and Vishu. Hashtag #MeeraWears.

### Image prompt pattern: holding or showing the product (influencer in her own clothes)
> Image 1 shows {name}. The other images show a product: {garment paragraph}. Keep {name} identical: {short identity}. {forbidden rules}. {conditional rules}. She is wearing {home outfit}. {scene}. The product must match the product images exactly in colour, embroidery or beadwork, neckline and cut. Photorealistic candid photo taken by a friend on a phone, warm natural indoor light, realistic skin texture, no other people visible, no text, no logos, no watermark. Aspect ratio 9:16.

### Image prompt pattern: wearing the product
> Image 1 shows {name}. The other images show a product: {garment paragraph}. Dress {name} in this exact outfit, matching the product images exactly in colour, embroidery or beadwork, neckline, sleeves, length and cut. Keep {name} identical: {short identity}. {forbidden rules}. {conditional rules}. {scene}. Photorealistic candid photo taken by a friend on a phone, natural light, realistic skin texture, no other people visible, no text, no watermark. Aspect ratio 9:16.

### Video prompt pattern (single scene)
> Static, locked-off camera. {motion}. {name}'s face and hair stay the same{, forbidden-feature reminder}, and the outfit stays exactly the same in every frame: same colour, pattern, neckline, length and cut. Subtle, realistic motion only, photorealistic.

Motion guidance: low motion. No turning around unless the back is known; no hands rubbing prints; no walking toward the camera in wearing shots unless needed.

### Example garment paragraph (the quality bar for step 2)
> Lavender net front-slit kurta set: a sheer lavender net kurta over a lavender lining, covered all over in dense white thread embroidery of vines, leaves, flowers and paisley-like motifs, with a heavier embroidered border near the hem ending in a small zigzag band. Round neckline with a small keyhole slit at the centre front. Full-length fitted sheer sleeves with the same white embroidery. Fitted bodice with a horizontal seam just under the bust; below it the kurta flares into an ankle-length A-line panel that is open at the centre front from the waist down. Plain, solid lavender straight-leg pants in a smooth matte fabric. Exact colour: soft lavender-lilac with white embroidery.

### Example on-screen texts (tone)
"Diwali fit unboxing 🪔", "Lavender net kurta set", "Kurta + matching pants", "All-over thread embroidery 😍", "Okay but on me 👀", "Comment LINK for the fit 👇".

## 10. Quality, testing and robustness

- Unit tests:
  - zod schemas
  - FFmpeg command builders (snapshot the generated args)
  - overlay placement algorithm (fixture boxes)
  - price band rounding
  - emoji rendering
  - reference-image selection rules
- An integration test that renders a short Reel from 3 bundled sample clips and overlays, then asserts the ffprobe output.
- Mock the Anthropic client in tests, with a recorded-fixture mode.
- Idempotent jobs and resume after a restart (jobs table). No lost uploads: write to a temp file, then rename.
- Validate uploads by type, size and video codec. Normalise odd inputs (variable frame rate, rotation metadata, 24 fps).
- Clear logs per project (`data/projects/{id}/logs`). Every FFmpeg command and every LLM call (minus image bytes) goes to the logs.
- README: setup (`pnpm i`, `.env`, `pnpm db:migrate`, `pnpm dev`), FFmpeg install notes for macOS, Windows and Linux, the font downloads (Google Fonts plus Noto Color Emoji), and how to add an influencer.

## 11. Build phases (stop and show me after each)

1. **Skeleton:** monorepo, NestJS + Next.js, Prisma schema, settings, influencer and source CRUD with uploads, seed data, `LlmService` with structured output, cost logging.
2. **Steps 1–3:** project creation, product analysis, storyboard with copy-ready prompts and attachment zips.
3. **Step 4:** image uploads, reviews, fix prompts, the modification assistant for images.
4. **Steps 5–6:** video prompts (multi-shot and single), video upload, cut detection, video review, timeline editor.
5. **Steps 7–8:** compose (text, badge placement, CTA, cover, caption package), FFmpeg render, QA, export.
6. **Polish:** usage dashboard, keyboard shortcuts, error states, README, tests passing.

Before phase 1, reply with:
- the proposed folder structure, Prisma schema and API route list
- any assumptions or questions, especially about the Kling multi-shot prompt format and Higgsfield reference-image limits, which I will confirm by testing
