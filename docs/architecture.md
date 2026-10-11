# Reel Studio: architecture proposal (pre-phase 1)

Status: **awaiting confirmation**. Nothing here is built yet.

## 0. Decisions from Q&A

| Topic | Decision |
|---|---|
| Aanya / Meera images | Seed text and persona rules only; images uploaded through the UI. |
| New characters | Added **Character Creator**: Haiku drafts the persona, then a reference-image plan (anchor, turnaround, base and close-up frames…) with paste-ready prompts, uploads, reviews against the anchor, and approval into the reference library. |
| Video reference images | Kling element references: up to **4** (tool-capability setting). |
| Image tool reference limits | Unknown; default **4** for GPT Image and for Nano Banana, editable in Settings. |
| Kling multi-shot format | One text prompt with `Shot N (a–bs): … Hard cut.` markers. Template is editable. |
| "Under ₹X" rounding | Below ₹1,000: next ₹100. ₹1,000–4,999: next ₹500. ₹5,000 and up: next ₹1,000. Always strictly above the price (₹1,500 → "Under ₹2,000"). |
| Display font | Poppins ExtraBold, plus Noto Color Emoji. |
| Git | Local repo, one commit per working phase, no remote. |
| API key | Pasted at test time. Until then, tests and dev use the mocked or recorded Anthropic client. |

Other technical choices:
- **Images:** `sharp` handles downscaling and JPEG re-encoding before Claude calls. Originals stay on disk.
- **Database values:** status and enum-like fields are `String` columns, validated by zod unions from `packages/shared`, which keeps them portable to Postgres. Arrays and objects use Prisma `Json`.
- **IDs:** `cuid()`.
- **Web to API:** the web app calls `http://localhost:4000/api` directly with CORS enabled. This avoids buffering SSE through Next.js rewrites.
- **Detection (browser):** MediaPipe Face Detector, Pose Landmarker (person box) and Hand Landmarker (hands).
  - **Garment detail regions:** MediaPipe can't find these. Haiku marks rough boxes on one sampled frame per segment, and the badge stays draggable as the final override.
- **Frame-accurate preview:** the server pulls the exact frame with FFmpeg (`GET /assets/:id/frame?t=`). The browser `<video>` element is used only for playback.

## 1. Folder structure

```
reel-studio/
├─ package.json                  pnpm workspace scripts: dev, build, test, db:migrate, db:seed
├─ pnpm-workspace.yaml
├─ .env.example
├─ apps/
│  ├─ api/                       NestJS (strict TS)
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma
│  │  │  ├─ migrations/
│  │  │  ├─ seed.ts
│  │  │  └─ seed-data/           influencers.ts, sources.ts, settings.ts
│  │  ├─ assets/fonts/           Poppins-ExtraBold.ttf, NotoColorEmoji.ttf, Inter (downloaded; see README)
│  │  ├─ src/
│  │  │  ├─ main.ts, app.module.ts
│  │  │  ├─ config/              zod env schema, startup checks (API key, ffmpeg/ffprobe)
│  │  │  ├─ common/              zod validation pipe, error filter, per-project logger
│  │  │  ├─ prisma/              PrismaService
│  │  │  ├─ storage/             DATA_DIR layout, atomic writes (tmp + rename), zip builder, file serving
│  │  │  ├─ jobs/                Job table repository, in-process worker, handler registry, SSE controller
│  │  │  ├─ llm/                 LlmService, structured output, image prep, pricing, fixture record/replay
│  │  │  ├─ prompts/             *.md system prompts and templates (versioned in front-matter)
│  │  │  ├─ media/               ffmpeg/ (typed command builders), ffprobe, frames, cut detection, QA
│  │  │  ├─ overlay/             canvas renderers (text, badge, CTA, cover), placement algorithm, price format
│  │  │  ├─ settings/
│  │  │  ├─ influencers/         CRUD, reference images, character-creator/
│  │  │  ├─ sources/
│  │  │  ├─ projects/            CRUD, status machine
│  │  │  ├─ product/             product images, analysis, ProductSpec, garment paragraph
│  │  │  ├─ storyboard/          scenes, prompt assembly, reference-selection rules, attachment zips
│  │  │  ├─ assets/              uploads (validation, normalisation), reviews, approve/reject
│  │  │  ├─ assistant/           modification assistant threads
│  │  │  ├─ video/               video jobs, prompts, cut mapping, segments, video review
│  │  │  ├─ compose/             composition, detections, placement, cover, caption package
│  │  │  ├─ render/              final render, QA, export
│  │  │  └─ usage/
│  │  └─ test/
│  │     ├─ fixtures/            sample clips (3 short mp4s), detection boxes, recorded LLM responses
│  │     └─ integration/         render.e2e-spec.ts
│  └─ web/                       Next.js App Router, Tailwind, shadcn/ui, TanStack Query
│     ├─ public/mediapipe/       .tflite/.task models and wasm (downloaded by a script)
│     └─ src/
│        ├─ app/
│        │  ├─ projects/                 list, new
│        │  ├─ projects/[id]/[step]/     product | analysis | storyboard | images | video-prompts | videos | compose | export
│        │  ├─ influencers/              list, [id], new (character creator)
│        │  ├─ sources/, settings/, usage/
│        ├─ components/
│        │  ├─ ui/               shadcn
│        │  ├─ prompt-card, attachment-strip, review-card, compare-view, stepper, job-progress
│        │  ├─ timeline-editor/, reel-preview/ (9:16 canvas), assistant-panel/
│        └─ lib/                 api client, SSE hook, query keys, mediapipe/ (detector in a Web Worker)
├─ packages/
│  └─ shared/src/
│     ├─ enums.ts                status, tag, role, and scene-type unions
│     ├─ schemas/                zod per domain (influencer, project, spec, scene, review, video, compose…)
│     ├─ llm/                    zod schemas for every LLM output (become tool input_schema)
│     └─ api.ts                  request/response DTO types
└─ data/                         (gitignored) DATA_DIR
   ├─ app.db
   ├─ tmp/
   ├─ influencers/{influencerId}/refs/{uuid}.{ext}
   ├─ influencers/{influencerId}/creator/{taskId}/v{n}.{ext}
   ├─ sources/{key}/logo.png
   └─ projects/{id}/
      ├─ product/{imageId}.{ext}
      ├─ scenes/{sceneId}/v{n}.{ext}
      ├─ videos/{jobId}/v{n}.mp4 (+ normalised.mp4)
      ├─ frames/{assetId}/…
      ├─ overlays/{segmentId}/text.png, badge.png
      ├─ renders/{renderId}/final.mp4, cover.jpg, cover_titled.jpg, contact_sheet.jpg, qa.json
      ├─ export/
      └─ logs/ffmpeg.log, llm.log, jobs.log
```

## 2. Prisma schema (draft)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL") // file:../../../data/app.db by default
}

model Setting {
  key       String   @id // e.g. llm.prices, tools.capabilities, refRules, video.multiShotTemplate, video.creditsPer5s,
                           // media.sceneThreshold, overlay.safeZone, compose.ctaDefaults, compose.badgeSceneTypes
  value     Json
  updatedAt DateTime @updatedAt
}

// ---------- Influencers ----------

model Influencer {
  id                  String   @id @default(cuid())
  slug                String   @unique
  name                String
  age                 Int
  city                String
  identityBlock       String   // full paragraph used in prompts
  shortIdentity       String   // compressed version used in "Keep {name} identical: …"
  voiceNotes          String
  personality         String
  lane                String   // content niche
  hashtag             String   // e.g. #AanyaPicks
  signatureDetails    Json     // string[]
  forbiddenFeatures   Json     // string[]
  conditionalFeatures Json     // { feature, rule }[]
  defaultStyling      String
  homeOutfit          String
  homeSetting         String
  status              String   @default("active") // draft | creating | active | archived
  creatorBrief        Json?    // inputs used by the character creator
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  references   ReferenceImage[]
  creatorTasks CreatorTask[]
  projects     Project[]
}

model ReferenceImage {
  id            String   @id @default(cuid())
  influencerId  String
  path          String   // relative to DATA_DIR
  width         Int
  height        Int
  tags          Json     // RefTag[]: anchor | turnaround | base_front | base_three_quarter | base_walk | base_hair_up |
                           // closeup_front | closeup_left | closeup_right | profile | hands | lifestyle
  note          String   @default("")
  sortOrder     Int      @default(0)
  creatorTaskId String?  @unique // set when promoted from the character creator
  createdAt     DateTime @default(now())

  influencer  Influencer   @relation(fields: [influencerId], references: [id], onDelete: Cascade)
  creatorTask CreatorTask? @relation(fields: [creatorTaskId], references: [id])

  @@index([influencerId])
}

// One step in a new character's reference-image plan (anchor first, then the rest)
model CreatorTask {
  id           String   @id @default(cuid())
  influencerId String
  order        Int
  tag          String   // target RefTag
  purpose      String
  prompt       String   // paste-ready Higgsfield prompt
  imageModel   String   // gpt_image | nano_banana
  modelReason  String
  attachments  Json     // AttachmentRef[] (resolved to approved refs; empty for anchor)
  status       String   @default("locked") // locked | ready | in_review | approved | skipped
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  influencer Influencer      @relation(fields: [influencerId], references: [id], onDelete: Cascade)
  assets     Asset[]
  reference  ReferenceImage?

  @@index([influencerId, order])
}

model Source {
  id              String  @id @default(cuid())
  key             String  @unique // amazon | myntra | meesho
  displayName     String
  logoPath        String?
  priceMode       String  // exact | under_band | hidden
  disclosureLines Json    // string[]
  linkNotes       String  @default("")

  projects Project[]
}

// ---------- Projects ----------

model Project {
  id              String    @id @default(cuid())
  influencerId    String
  sourceId        String
  productTitle    String
  priceInr        Int
  priceModeOverride String? // overrides Source.priceMode for this project
  productUrl      String?
  affiliateLink   String?
  occasion        String
  status          String    @default("draft")
  furthestStatus  String    @default("draft") // for "go back without losing data"
  videoMode       String    @default("multi_shot") // multi_shot | single
  postedAt        DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  influencer    Influencer      @relation(fields: [influencerId], references: [id])
  source        Source          @relation(fields: [sourceId], references: [id])
  productImages ProductImage[]
  spec          ProductSpec?
  scenes        Scene[]
  videoJobs     VideoJob[]
  assets        Asset[]
  segments      Segment[]
  composition   Composition?
  captions      CaptionPackage?
  renders       Render[]
  llmCalls      LlmCall[]
  jobs          Job[]
}

model ProductImage {
  id        String @id @default(cuid())
  projectId String
  path      String
  width     Int
  height    Int
  role      String // front | back | detail | pants | lifestyle | other
  order     Int

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, order])
}

model ProductSpec {
  id               String   @id @default(cuid())
  projectId        String   @unique
  spec             Json     // ProductSpecSchema (category, pieces, colours, fabric, neckline, …)
  mustMatch        Json     // { key, label, expected }[] (6–10)
  unknowns         Json     // string[]
  garmentParagraph String
  version          Int      @default(1)
  editedByUser     Boolean  @default(false)
  updatedAt        DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model Scene {
  id                String   @id @default(cuid())
  projectId         String
  order             Int
  type              String   // unboxing | hold_up | pieces | detail | wearing_front | wearing_alt | custom
  purpose           String
  onScreenText      String
  targetDurationSec Float
  setting           String
  outfitState       String   // own_clothes | wearing_product
  showsProduct      Boolean  @default(true) // drives badge eligibility
  imagePrompt       String
  imageModel        String   // gpt_image | nano_banana
  imageModelReason  String
  attachments       Json     // AttachmentRef[]: { kind: reference|product|asset, id, label }
  motion            String
  approvedAssetId   String?  @unique
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  assets        Asset[]  @relation("SceneAssets")
  approvedAsset Asset?   @relation("SceneApproved", fields: [approvedAssetId], references: [id])
  segment       Segment?

  @@index([projectId, order])
}

// Uploaded generated image or video. Exactly one owner: scene, video job, or creator task.
model Asset {
  id            String   @id @default(cuid())
  projectId     String?
  sceneId       String?
  videoJobId    String?
  creatorTaskId String?
  kind          String   // image | video
  version       Int
  path          String
  normalizedPath String?  // videos: CFR/rotation-fixed copy
  mime          String
  width         Int
  height        Int
  durationSec   Float?
  probe         Json?    // ffprobe summary
  detectedCuts  Json?    // number[] seconds
  shotBounds    Json?    // { sceneId, start, end }[] after mapping or manual drag
  status        String   @default("pending_review") // pending_review | approved | rejected
  sourcePrompt  String   @default("")
  createdAt     DateTime @default(now())

  project     Project?     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  scene       Scene?       @relation("SceneAssets", fields: [sceneId], references: [id], onDelete: Cascade)
  approvedFor Scene?       @relation("SceneApproved")
  videoJob    VideoJob?    @relation(fields: [videoJobId], references: [id], onDelete: Cascade)
  creatorTask CreatorTask? @relation(fields: [creatorTaskId], references: [id], onDelete: Cascade)
  reviews     Review[]
  segments    Segment[]
  messages    AssistantMessage[]

  @@index([sceneId])
  @@index([videoJobId])
  @@index([creatorTaskId])
}

model Review {
  id         String   @id @default(cuid())
  assetId    String
  verdict    String   // pass | warn | fail
  checklist  Json     // { group: identity|garment|anatomy|artefacts|composition, item, result: match|partial|mismatch, note }[]
  issues     Json     // { severity, description, region? {x,y,w,h} (normalised), shotIndex? }[]
  fixPrompts Json     // { prompt, tool, attachments: AttachmentRef[], checkAfter: string[] }[]
  shots      Json?    // video only: { sceneId, verdict, suggestedIn, suggestedOut, notes }[]
  model      String
  llmCallId  String?
  createdAt  DateTime @default(now())

  asset Asset @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@index([assetId])
}

model VideoJob {
  id              String   @id @default(cuid())
  projectId       String
  mode            String   // multi_shot | single
  order           Int
  active          Boolean  @default(true) // inactive jobs are kept when switching mode
  prompt          String
  startAssetId    String   // approved image of the first scene
  extraRefs       Json     // AttachmentRef[] (≤ tools.capabilities.kling.maxElementRefs, default 4)
  expectedShots   Json     // { sceneId, start, end, text }[]
  settings        Json     // { resolution: "720p", sound: false, durationSec }
  creditEstimate  Float
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  assets  Asset[]

  @@index([projectId, mode, order])
}

model Segment {
  id               String  @id @default(cuid())
  projectId        String
  sceneId          String  @unique
  assetId          String  // video asset
  order            Int
  inSec            Float
  outSec           Float
  suggestedInSec   Float?
  suggestedOutSec  Float?
  onScreenText     String
  textBox          Json?   // normalised box of the rendered text
  detections       Json?   // { faces, hands, persons, details } boxes, union over sampled frames
  badgeEnabled     Boolean @default(true)
  badgePlacement   Json?   // { anchor, x, y, scale, manual: boolean, overlapScore }
  placementWarning String?

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  scene   Scene   @relation(fields: [sceneId], references: [id], onDelete: Cascade)
  asset   Asset   @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@index([projectId, order])
}

model Composition {
  id        String   @id @default(cuid())
  projectId String   @unique
  cta       Json     // { text, durationSec, background: last_frame|chosen_frame, frameRef?, zoom, darken }
  cover     Json     // { assetId, timeSec, titleOptions: string[], chosenTitle?, plainPath?, titledPath? }
  music     Json?    // { path, targetLufs, fadeOutSec }
  updatedAt DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model CaptionPackage {
  id           String   @id @default(cuid())
  projectId    String   @unique
  caption      String
  hashtags     Json     // string[]
  firstComment String?
  dmTemplate   String
  coverTitles  Json     // string[]
  sceneTexts   Json     // { sceneId, text }[]
  checklist    Json     // { item, done }[]
  updatedAt    DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model Render {
  id          String    @id @default(cuid())
  projectId   String
  status      String    // queued | running | succeeded | failed
  settings    Json      // full snapshot (segments, overlays, cta, encode params)
  outputDir   String
  probe       Json?
  qa          Json?     // { checks, blackFrames, totalDuration, contactSheet }
  warnings    Json      // string[]
  createdAt   DateTime  @default(now())
  finishedAt  DateTime?

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

// Modification assistant history; targets an asset (image or video) or a scene before any upload
model AssistantMessage {
  id        String   @id @default(cuid())
  assetId   String?
  sceneId   String?
  role      String   // user | assistant
  content   String
  output    Json?    // { editPrompt, tool, attachments: AttachmentRef[], checkAfter: string[] }
  createdAt DateTime @default(now())

  asset Asset? @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@index([assetId])
  @@index([sceneId])
}

// ---------- Infra ----------

model LlmCall {
  id               String   @id @default(cuid())
  task             String   // product_analysis | storyboard | image_review | video_review | captions | persona | …
  model            String
  projectId        String?
  influencerId     String?
  inputTokens      Int
  outputTokens     Int
  cacheReadTokens  Int      @default(0)
  cacheWriteTokens Int      @default(0)
  costUsd          Float    // computed with prices at call time
  latencyMs        Int
  attempts         Int      @default(1)
  ok               Boolean
  error            String?
  createdAt        DateTime @default(now())

  project Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)

  @@index([projectId])
  @@index([createdAt])
}

model Job {
  id             String    @id @default(cuid())
  type           String    // llm.* | ffmpeg.* | frames.extract | …
  status         String    @default("queued") // queued | running | succeeded | failed | cancelled
  idempotencyKey String?   @unique
  projectId      String?
  payload        Json
  result         Json?
  error          String?
  progress       Float     @default(0)
  message        String    @default("")
  attempts       Int       @default(0)
  createdAt      DateTime  @default(now())
  startedAt      DateTime?
  finishedAt     DateTime?

  project Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([status, createdAt])
  @@index([projectId])
}
```

`.env` gains one line: `DATABASE_URL=file:../../../data/app.db`.

## 3. API routes (prefix `/api`)

**System**
- `GET /health`
- `GET /settings`, `PUT /settings/:key`
- `GET /files/*`: serves DATA_DIR-relative files, with path-traversal protection
- `GET /events?projectId=`: SSE stream of job progress
- `GET /jobs?projectId=&status=`, `GET /jobs/:id`, `POST /jobs/:id/retry`, `POST /jobs/:id/cancel`
- `GET /usage?from=&to=&groupBy=project|month|task`

**Influencers**
- `GET /influencers`, `POST /influencers`, `GET /influencers/:id`, `PATCH /influencers/:id`, `DELETE /influencers/:id`
- `POST /influencers/:id/references` (multipart, tags[], note), `PATCH /references/:id`, `DELETE /references/:id`
- `POST /influencers/:id/sample-prompt`

**Character creator**
- `POST /influencers/draft`: brief in, Haiku persona out, creates a `draft` influencer (job)
- `POST /influencers/:id/persona/regenerate` `{ instruction? }`
- `POST /influencers/:id/creator/plan`: builds the CreatorTasks, with the anchor unlocked first
- `GET /influencers/:id/creator/tasks`, `PATCH /creator-tasks/:id`
- `POST /creator-tasks/:id/regenerate-prompt` `{ instruction? }`
- `GET /creator-tasks/:id/attachments.zip`
- `POST /creator-tasks/:id/assets`: upload starts the review job (anchor gets a quality check; the rest are checked for consistency with the anchor)
- `POST /influencers/:id/activate`

**Sources**
- `GET /sources`, `PATCH /sources/:id`, `POST /sources/:id/logo`

**Projects (steps 1–3)**
- `GET /projects`, `POST /projects` (multipart, with product images and roles), `GET /projects/:id`, `PATCH /projects/:id`, `DELETE /projects/:id`
- `POST /projects/:id/goto` `{ status }`, `POST /projects/:id/posted`
- `POST /projects/:id/product-images`, `PATCH /product-images/:id`, `DELETE /product-images/:id`, `PUT /projects/:id/product-images/order`
- `POST /projects/:id/analyze` (job), `GET /projects/:id/spec`, `PUT /projects/:id/spec`, `POST /projects/:id/spec/paragraph` (regenerate)
- `POST /projects/:id/storyboard` `{ instruction? }` (job), `GET /projects/:id/scenes`, `POST /projects/:id/scenes`, `PATCH /scenes/:id`, `DELETE /scenes/:id`, `PUT /projects/:id/scenes/order`
- `POST /scenes/:id/regenerate-prompt` `{ instruction? }`, `POST /scenes/:id/reselect-attachments`
- `GET /scenes/:id/attachments.zip`

**Images and review (step 4)**
- `POST /scenes/:id/assets` (upload, then review job), `GET /assets/:id`
- `POST /assets/:id/review` (re-run), `POST /assets/:id/approve`, `POST /assets/:id/reject`
- `GET /reviews/:id/fixes/:index/attachments.zip`

**Modification assistant**
- `GET /assets/:id/assistant`, `POST /assets/:id/assistant` `{ message }`
- `GET /scenes/:id/assistant`, `POST /scenes/:id/assistant`
- `GET /assistant-messages/:id/attachments.zip`

**Video (steps 5–6)**
- `PUT /projects/:id/video-mode`, `POST /projects/:id/video-jobs/generate` (job), `GET /projects/:id/video-jobs`
- `PATCH /video-jobs/:id`, `POST /video-jobs/:id/regenerate-prompt`, `GET /video-jobs/:id/attachments.zip`
- `POST /video-jobs/:id/assets`: upload starts this job chain: probe, normalise, cuts, mapping, frames, review
- `POST /assets/:id/cuts` `{ threshold }` (re-detect), `PUT /assets/:id/shot-bounds`
- `GET /assets/:id/frame?t=` (exact frame, JPEG)
- `GET /projects/:id/segments`, `PUT /segments/:id` (in/out, text, badge)
- `POST /segments/:id/single-scene-prompt`

**Compose (step 7)**
- `GET /projects/:id/composition`, `PUT /projects/:id/composition`
- `POST /segments/:id/detections` (MediaPipe boxes from the browser), `POST /segments/:id/detail-regions` (Haiku), `POST /segments/:id/placement` (compute), `POST /segments/:id/placement/check` (Haiku sanity check)
- `GET /segments/:id/overlay.png?layer=text|badge` (exactly what the render will use)
- `POST /projects/:id/cover/suggest` (job), `POST /projects/:id/cover/render`
- `POST /projects/:id/captions` (job), `GET /projects/:id/captions`, `PUT /projects/:id/captions`
- `POST /projects/:id/music`, `DELETE /projects/:id/music`

**Render and export (step 8)**
- `POST /projects/:id/renders` (job), `GET /projects/:id/renders`, `GET /renders/:id`
- `GET /renders/:id/files/:name`, `GET /renders/:id/export.zip`

## 4. Character creator flow

1. **Brief:** name (optional), age, city or region, lane or niche, vibe keywords, look notes, voice language and tone, and any must-have or must-avoid features.
2. **Persona (Haiku):** identity block, short identity, signature details, forbidden and conditional features, voice notes with example lines, home outfit and setting, and a hashtag. Everything is editable and can be regenerated.
3. **Reference plan:** one prompt card per frame, generated in this order:
   1. **anchor:** text-to-image, no attachments. Generate several, upload them all, and pick one.
   2. **turnaround:** a character sheet with front, three-quarter, side and back views on a neutral background. Attaches the anchor.
   3. **base_front, base_three_quarter, base_walk, base_hair_up:** neutral outfit, full body. Each attaches the anchor and the turnaround.
   4. **closeup_front, closeup_left, closeup_right, profile:** attach the anchor.
   5. **hands** (includes the conditional tattoo, where relevant) and **lifestyle**.
4. **Review:** each upload is reviewed against the anchor for face match, age look, hair, and forbidden and conditional features. Approving a frame turns it into a tagged `ReferenceImage`. Activating the influencer requires at least the anchor; the rest is recommended.

## 5. Build phases (updated)

1. **Skeleton:**
   - monorepo, NestJS and Next.js, Prisma, settings
   - influencer and source CRUD with uploads, seed data
   - `LlmService` (structured output, mocked client), cost logging, jobs and SSE
   - character creator: persona step only
2. **Steps 1–3:** project creation, product analysis, storyboard, copy-ready prompts, attachment zips.
3. **Step 4:** image upload and review, fix prompts, the modification assistant for images, and the **character creator reference plan** (it reuses the same upload and review pipeline).
4. **Steps 5–6:** video prompts, upload, cut detection, video review, timeline editor.
5. **Steps 7–8:** compose, placement, CTA, cover, captions, render, QA, export.
6. **Polish:** usage dashboard, keyboard shortcuts, error states, README, all tests green.
