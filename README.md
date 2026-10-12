# Reel Studio

A local, single-user app that turns product photos into upload-ready Instagram Reels for **@slayurbansociety**, featuring recurring AI influencers. You generate the images and videos yourself on Higgsfield. Reel Studio writes the prompts, tells you which images to attach, reviews what you generate, writes the text, places the overlays and assembles the video with FFmpeg.

The brief is in [docs/reel_studio_claude_code_prompt.md](docs/reel_studio_claude_code_prompt.md), and the agreed architecture is in [docs/architecture.md](docs/architecture.md).

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Skeleton, settings, influencer and source CRUD, character-creator persona step, `LlmService`, cost log, jobs and SSE | ✅ |
| 2 | New project, product analysis, storyboard, attachment zips | ✅ |
| 3 | Image review, fix prompts, modification assistant, character-creator reference plan | ✅ |
| 4 | Video prompts, cut detection, video review, timeline editor | — |
| 5 | Compose, badge placement, CTA, cover, captions, render, export | — |
| 6 | Polish | — |

## Setup

Requirements: **Node 22.12+**, **pnpm 10**, **FFmpeg + ffprobe** on your PATH.

```bash
pnpm i
cp .env.example .env        # then fill in ANTHROPIC_API_KEY
pnpm db:migrate             # creates data/app.db
pnpm db:seed                # Aanya, Meera, and the Amazon / Myntra / Meesho sources
pnpm dev                    # API on :4000, web on :3000
```

Open http://localhost:3000.

### `.env`

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required when `LLM_MODE` is `live` or `record`. |
| `ANTHROPIC_MODEL_DEFAULT` | `claude-haiku-5-5` | Most tasks. |
| `ANTHROPIC_MODEL_REVIEW` | `claude-haiku-5-5` | Image and video reviews. Switch to a stronger model here. |
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

### Fonts (needed from phase 5)

Overlay text is rendered with `@napi-rs/canvas`. Put these in `apps/api/assets/fonts/` (the folder is git-ignored):

- **Poppins ExtraBold** (`Poppins-ExtraBold.ttf`) from Google Fonts: https://fonts.google.com/specimen/Poppins
- **Noto Color Emoji** (`NotoColorEmoji.ttf`): https://fonts.google.com/noto/specimen/Noto+Color+Emoji

## Making a Reel (steps 1–4)

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

Reference images are chosen by the rules in **Settings → Reference image selection rules** (anchor first; `base_front` or `base_hair_up` for full-body shots; `base_three_quarter` for ¾; `turnaround` for back views; anchor only for close-ups), within each image tool's reference limit.

Check the live API connection any time with `pnpm --filter @reel/api llm:check` (one tiny call per configured model).

## Adding an influencer

**New character (AI):** go to Influencers → **New character** and fill in the brief: age, city, lane, vibe, voice, and any must-have or must-avoid features. Claude drafts the identity block, forbidden and conditional feature rules, and voice. Review and edit the draft and use **Rewrite with AI** for targeted changes. Then open the **Reference plan** tab:

1. **Create reference plan** gives one Higgsfield prompt per frame: anchor, turnaround, base front / ¾ / walk / hair up, close-ups (front, left, right), profile, hands and lifestyle. Prompts are assembled from her persona, so identity and feature rules are always verbatim; **Rewrite with AI** or **Edit** changes one, **Reset to default** rebuilds it.
2. Start with the **anchor** (text to image, nothing attached). Upload a few variations; Claude checks each against her description and as a reference (sharp, front-facing, unobstructed). **Approve** the best: it becomes her anchor.
3. The other frames unlock and attach the anchor (and the turnaround, once approved) in order. Uploads are checked for consistency with the anchor; approving one adds it to her references with the right tag. Skip any frame you don't need.
4. Click **Activate** (only the anchor is required).

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
pnpm test         # vitest in packages/shared and apps/api
pnpm typecheck
pnpm build
pnpm db:migrate   # prisma migrate dev
pnpm db:seed      # idempotent: never overwrites edits made in the UI
```
