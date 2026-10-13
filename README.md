# Reel Studio

A local, single-user app that turns product photos into upload-ready Instagram Reels for **@slayurbansociety**, featuring recurring AI influencers. You generate the images and videos yourself on Higgsfield. Reel Studio writes the prompts, tells you which images to attach, reviews what you generate, writes the text, places the overlays and assembles the video with FFmpeg.

The brief is in [docs/reel_studio_claude_code_prompt.md](docs/reel_studio_claude_code_prompt.md), and the agreed architecture is in [docs/architecture.md](docs/architecture.md).

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Skeleton, settings, influencer and source CRUD, character-creator persona step, `LlmService`, cost log, jobs and SSE | ✅ |
| 2 | New project, product analysis, storyboard, attachment zips | ✅ |
| 3 | Image review, fix prompts, modification assistant, character-creator reference plan | ✅ |
| 4 | Video prompts, cut detection, video review, timeline editor | ✅ |
| 5 | Compose, badge placement, CTA, cover, captions, render, export | ✅ |
| 6 | Polish: usage dashboard, keyboard shortcuts, error states, video modification assistant, render integration test | ✅ |

## Setup

Requirements: **Node 22.12+** (`.nvmrc`), **pnpm 10** (`corepack enable`), **FFmpeg + ffprobe** on your PATH.

```bash
git clone https://github.com/ashishsk93/reel-studio.git
cd reel-studio
pnpm i
cp .env.example .env        # then fill in ANTHROPIC_API_KEY
pnpm db:migrate             # creates data/app.db
pnpm db:seed                # Aanya, Meera, and the Amazon / Myntra / Meesho sources
pnpm --filter @reel/web mediapipe   # face / pose / hand models for badge placement (public/mediapipe)
pnpm dev                    # API on :4000, web on :3000
```

Open http://localhost:3000.

Not in the repository (git-ignored), so a fresh clone needs them: `.env` (your key), `data/` (database, uploads, renders), the fonts below, and the MediaPipe models (`pnpm --filter @reel/web mediapipe`). Back up `data/` yourself; it holds every project.

### `.env`

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required when `LLM_MODE` is `live` or `record`. |
| `ANTHROPIC_MODEL_DEFAULT` | `claude-haiku-5-5` | Most tasks. |
| `ANTHROPIC_MODEL_REVIEW` | `claude-haiku-5-5` | Image and video reviews. Switch to a stronger model here. |
| `OPENAI_API_KEY` | — | Optional. Turns on [OpenAI's Decisions API](https://developers.openai.com/api/docs/guides/decisions) (GPT-6 Luna) for the app's yes/no and pick-one decisions, which look at the images: the **Recommended** version when a scene has several reviewed images or videos, the badge check on the composited frame, the cover frame, and a copy guardrail that catches paraphrased feel / fit / quality / deal claims. Prompts, reviews and all written text stay on Claude. Without a key, the review verdicts, Claude and the word-list rules decide. $0.10 per 1M input tokens, a fraction of a cent per Reel. |
| `OPENAI_DECISION_MODEL` | `gpt-6-luna` | Decisions model id. |
| `LLM_MODE` | `live` | `live` calls Claude. `mock` returns canned fixtures from `apps/api/test/fixtures/llm` (no key needed; tasks whose output depends on the project, such as image reviews, have no generic fixture). `record` calls Claude and saves each answer as a fixture. `replay` only uses saved fixtures. |
| `DATA_DIR` | `./data` | Database, uploads, renders and logs. Relative to the repo root. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Full paths if they aren't on your PATH. |
| `PORT_API` / `PORT_WEB` | `4000` / `3000` | |

The API refuses to start, listing every problem at once, if the key is missing in `live` mode or FFmpeg can't be run.

### Installing FFmpeg

- **Windows:** `winget install Gyan.FFmpeg` (or download the "full" build from gyan.dev and add its `bin` folder to PATH). Restart the terminal afterwards.
- **macOS:** `brew install ffmpeg`
- **Linux:** `sudo apt install ffmpeg` (Debian/Ubuntu) or your distro's package.

Check with `ffmpeg -version` and `ffprobe -version`.

Video uploads: MP4, MOV, M4V, WebM or MKV, up to 60 s and 1 GB.

### Fonts

Overlay text is rendered with `@napi-rs/canvas`. Put these in `apps/api/assets/fonts/` (the folder is git-ignored):

- **Poppins ExtraBold** (`Poppins-ExtraBold.ttf`) from Google Fonts: https://fonts.google.com/specimen/Poppins
- **Noto Color Emoji** (`NotoColorEmoji.ttf`): https://fonts.google.com/noto/specimen/Noto+Color+Emoji

## Story formats

Pick one when creating a project (details in [docs/formats.md](docs/formats.md)):

| Format | Products | The Reel |
|---|---|---|
| Classic | 1 | Unboxing, hold up, details, then wearing it |
| Price-cap haul | 2–5 | Title hook, then a quick try-on of each product with its own store and price badge |
| Occasion edit | 2–5 | Same, themed by occasion ("3 Diwali looks") |
| Outfit transition | 1–3 | Her own clothes → a quick spin or hand-across-lens → wearing it (Kling start + end frames) |
| One piece, 3 ways | 1 | The same piece styled for three occasions |

Each product has its own photos, analysis, store, price, links and an optional on-screen note. Captions list every product with its price, and the LINK DM lists every link.

## Making a Reel (steps 1–8)

1. **Projects → New project.** Drop the listing photos and tag each one (front, back, detail, pants…). Pick the source, price, occasion and influencer. The badge preview shows how the price will appear (Amazon defaults to "Under ₹X").
2. **Analysis** starts automatically. Claude writes the garment spec, a 6–10 item must-match checklist, the unknowns (never put in prompts) and the paste-ready garment paragraph. Edit anything, then **Save**. **Rewrite from spec** rebuilds the paragraph from your edits.
3. **Storyboard.** Claude plans the scenes; the app assembles every prompt from the persona, the garment paragraph and the templates in `apps/api/src/prompts/templates/`, so there are never placeholders. Each scene shows its prompt, the images to attach in order, the recommended image model, and a zip with the attachments renamed `1_aanya_anchor.jpg`, `2_product_front.jpg`… **All attachments + prompts** downloads every scene in one zip.

4. **Images.** Pick a scene, generate it in Higgsfield with its prompt and attachments, and drop the results in (several versions per scene are fine). Each upload gets a review from the review model (`ANTHROPIC_MODEL_REVIEW`), compared with her anchor and references, the product photos and the must-match list:
   - a **verdict** (pass / warn / fail), the **issues** (hover one to outline it on the image) and a checklist for identity, garment (one row per must-match item), anatomy, artefacts and composition;
   - the app also checks exactly that the image is 9:16 and that her face is clear of the bands Instagram covers (**Safe zone** shows them);
   - **fix prompts**: paste-ready edit prompts ("change only X, keep everything else identical"), with the images to attach in order (`1_edit_this.jpg`, `2_aanya_anchor.jpg`…) as a zip;
   - **Compare** opens the image next to her references and the product photos, with a magnifier;
   - **Modify** opens the modification assistant: describe a change ("make the embroidery denser on the sleeves") and get an edit prompt, the attachments and what to check afterwards. The conversation is kept per image.

   **Approve** one image per scene (approving another replaces it). When every scene is approved, step 5 unlocks.
5. **Video prompts.** Pick a mode (you can switch any time; each mode keeps its own prompts and uploads):
   - **Single scene** (default, recommended): one image-to-video prompt per scene, started from that scene's approved still, as long as the scene needs (minimum 3 s). Kling 3.0 on Higgsfield takes only a start frame (no reference images), so this keeps every scene on its own still.
   - **Multi-shot**: consecutive scenes in the same place and outfit state become one run of up to 15 s with `Shot N (a–bs): … Hard cut.` markers (template in **Settings → Kling multi-shot prompt template**). Only the first still is used; later shots come from the prompt alone.

   Every prompt locks her expression (no sighing, frowning or talking).

   Each shot is generated a little longer than the scene needs (`shotPaddingSec`, default 1.5 s) so there is room to trim. **Rewrite with AI** changes a prompt and keeps the shot markers and consistency lines; **Edit** and **Reset to template** work as for images.
6. **Videos.** Upload each Kling result under its run. The app:
   1. probes it, then makes a constant-30 fps H.264 copy (fixes variable frame rate, 24 fps and rotation);
   2. detects the cuts and matches them to the planned shots (strong cuts within 1 s, weaker changes within 0.5 s of the plan; dashed lines in the timeline mean no cut was found);
   3. extracts frames (each shot's middle, both sides of every cut, the first and last frame, plus 2 fps up to 24) and Claude reviews them shot by shot: identity drift, forbidden features, garment morphing, flicker, anatomy, and whether the shot matches its scene;
   4. picks a window per scene: Claude chooses where the best stretch starts (expression, natural motion, clearest garment), inside the clean part of the shot and never in its last 0.3 s.

   **Modify** opens the modification assistant for the video: describe a change ("she sighs at the end") and get a replacement shot or a prompt rewrite.

   The **timeline editor** shows the player with frame stepping, the planned shots, the detected cuts and one pink window per scene. Drag a cut line to move a shot boundary, or a window and its edges to choose what goes in the Reel; the exact frame under the handle is pulled from the server. **Save timeline** keeps your edits (reviews no longer move them); **Reset to suggestion** puts the review's windows back.

   A review fix can **regenerate one shot alone**: it gives a single-scene prompt from that scene's approved image, and **Add as replacement shot** creates its own upload slot. An approved replacement is used for that scene instead of the run's shot. **Approve** a video and its windows become the Reel's segments; when every scene has one, step 7 unlocks.

7. **Compose.**
   - **Text and badge.** Each segment's on-screen text (editable) is drawn exactly as rendered: Poppins ExtraBold, white with a black outline and soft shadow, colour emoji, around 40 % height, moved below her face when detection shows they would overlap. Product scenes (Settings → badge scenes) get the store logo and price pill (the price follows the store's display mode: exact, "Under ₹X" or hidden).
     When the page opens, MediaPipe runs in the browser on 5 frames per segment to find her face, hands and body, and Claude marks the garment's key detail areas. The badge goes to the best of six safe-zone positions: never on her face or the text, avoiding hands and garment detail, keeping the same corner across segments where it can; if nothing is clean it shrinks to 80 %, then takes the least-overlapping spot with a warning. Drag the badge in the 9:16 preview to place it yourself (**Auto** returns it), toggle **Instagram UI areas** and **Detections** to see what it avoids, and **Check with Claude** looks at the composited frame.
   - **End card.** "Comment **LINK** and I'll DM you the link 👇" (editable; LINK gets a pink pill, the pointer bounces), 2–4 s, over a freeze of the last frame or a frame you choose, darkened, with a slow zoom.
   - **Cover.** Claude picks the best frame and writes three titles; pick or edit one and it renders `cover.jpg` and `cover_titled.jpg` (title inside the centre 1080×1440 grid crop, away from her face).
   - **Caption and music.** Claude writes the hook, outfit lines (facts from the spec), hashtags (always #SlayUrbanSociety and hers) and the LINK DM in her voice; the app adds the CTA line, the store's disclosure lines and the affiliate link. Everything is editable with copy buttons, plus a posting checklist. Copy rules are enforced: no feel, fit, quality or sizing claims, no discounts, urgency or delivery promises. Music is optional: by default the Reel has a silent track for trending audio; an uploaded track is normalised to about -14 LUFS and faded out.
8. **Export.** **Render the Reel**: one FFmpeg pass (each segment trimmed, scaled to cover, centre-cropped, overlays composited; the end card; concat; 1080×1920, 30 fps, H.264 High, CRF 18, AAC 48 kHz stereo, `+faststart`). Then automatic QA: ffprobe checks, duration (16–20 s), black frames at the joins, and a contact sheet. Download `final.mp4`, the covers, `caption.txt`, `first_comment.txt`, `dm_template.txt`, or everything as a zip, and **Mark as posted**.

Reference images are chosen by the rules in **Settings → Reference image selection rules** (anchor first; `base_front` or `base_hair_up` for full-body shots; `base_three_quarter` for ¾; `turnaround` for back views; anchor only for close-ups), within each image tool's reference limit.

Check the live API connection any time with `pnpm --filter @reel/api llm:check` (one tiny call per configured model).

## Keyboard shortcuts

`C` copies the prompt under the mouse (or the first on screen), `Z` downloads its attachments, `[` / `]` move between steps, `1`–`8` jump to a step, `?` lists them all.

## Adding an influencer

**New character (AI):** go to Influencers → **New character** and fill in the brief: age, city, lane, vibe, voice, and any must-have or must-avoid features. Claude drafts the identity block, forbidden and conditional feature rules, and voice. Review and edit the draft and use **Rewrite with AI** for targeted changes. Then open the **Reference plan** tab:

1. **Create reference plan** gives one Higgsfield prompt per frame: anchor, turnaround, base front / ¾ / walk / hair up, close-ups (front, left, right), profile, hands and lifestyle. Prompts are assembled from her persona, so identity and feature rules are always verbatim; **Rewrite with AI** or **Edit** changes one, **Reset to default** rebuilds it.
2. Start with the **anchor** (text to image, nothing attached). Upload a few variations; Claude checks each against her description and as a reference (sharp, front-facing, unobstructed). **Approve** the best: it becomes her anchor.
3. The other frames unlock and attach the anchor (and the turnaround, once approved) in order. Uploads are checked for consistency with the anchor; approving one adds it to her references with the right tag. Skip any frame you don't need.
4. Generate **Her room** (an empty photo of her home setting): scenes set there attach it as the background so the room stays the same in every Reel. Other places can be uploaded under References with the `background` tag; the note is the room description the storyboard uses.
5. Click **Activate** (only the anchor is required).

Tags she already has (e.g. existing characters) start as approved, so the plan also fills gaps for Aanya and Meera.

**Existing character:** go to Influencers → **Add existing**, fill in the persona, then upload her reference images under **References**:

1. Upload the **anchor** on its own first. There is only one anchor; tagging a new image as anchor moves the tag.
2. Add the rest with their tags: `turnaround`, `base_front`, `base_three_quarter`, `base_walk`, `base_hair_up`, `closeup_front` / `closeup_left` / `closeup_right`, `profile`, `hands`, `lifestyle`. The coverage bar shows which tags are still missing.
3. Use **Test prompt** to get a full-body sample prompt and check that her face holds in Higgsfield.

## Project layout

```
apps/api        NestJS API: Prisma (SQLite), jobs + SSE, LlmService, FFmpeg
apps/web        Next.js UI: Tailwind, shadcn/ui, TanStack Query
packages/shared zod schemas, enums, settings defaults and DTO types used by both
data/           DATA_DIR (git-ignored): app.db, uploads, logs/
```

- System prompts and prompt templates are versioned `.md` files in `apps/api/src/prompts/`.
- Every Claude call is logged to the `LlmCall` table (see **Usage & costs**) and to `data/logs/llm.log`, or to `data/projects/{id}/logs/llm.log` for project calls. Image bytes are never logged.

## Scripts

```bash
pnpm dev          # shared (watch) + API (watch) + web
pnpm test         # vitest in packages/shared and apps/api (includes a real FFmpeg render of 3 bundled clips)
pnpm typecheck
pnpm lint
pnpm build
pnpm db:migrate   # prisma migrate dev
pnpm db:seed      # idempotent: never overwrites edits made in the UI
```
