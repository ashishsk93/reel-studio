import { hasPlaceholder, type ImageModel, type RefTag } from '@reel/shared';
import type { PromptService } from '../llm/prompt.service';
import { personImagesLead, personaRules, sentence, slugify, tidyPrompt } from '../influencers/persona-text';
import type { RefCandidate, SelectedAttachment } from '../storyboard/reference-rules';

type Outfit = 'top' | 'full' | 'hairUp' | 'home';
type Background = 'studio' | 'home';

export interface FrameDef {
  tag: RefTag;
  purpose: string;
  /** Reference tags to attach, in order (only approved references; missing ones are reported). */
  attach: RefTag[];
  imageModel: ImageModel;
  modelReason: string;
  aspect: string;
  tips: string[];
  framing: (first: string) => string;
  outfit: Outfit;
  background: Background;
}

const OUTFITS: Record<Exclude<Outfit, 'home'>, string> = {
  top: 'a plain fitted white crew-neck t-shirt.',
  full: 'a plain fitted white crew-neck t-shirt, straight-leg mid-blue jeans and plain white sneakers.',
  hairUp: 'a plain fitted black sleeveless top with a high round neck, straight-leg mid-blue jeans and plain white sneakers.',
};
const STUDIO = 'Plain light-grey studio background, soft even daylight, no harsh shadows.';

const FACE_TIP = 'Generate 2–4 variations, upload the best ones and approve the one closest to her anchor.';

/** The reference-image plan, in the order it should be generated. */
export const FRAMES: FrameDef[] = [
  {
    tag: 'anchor',
    purpose: 'Defines her face. Every other frame and every Reel is matched to this image.',
    attach: [],
    imageModel: 'gpt_image',
    modelReason: 'Follows a long identity description well from text alone.',
    aspect: '3:4',
    tips: [
      'Text to image: attach nothing.',
      'Generate 4 or more variations, upload the 2–3 best and approve one. Choose a face you are happy to use in every Reel.',
    ],
    framing: () =>
      'Head-and-shoulders portrait down to mid-chest, facing the camera straight on at eye level, looking directly into the lens with a soft, natural closed-mouth smile, face fully visible with no hair across the eyes.',
    outfit: 'top',
    background: 'studio',
  },
  {
    tag: 'turnaround',
    purpose: 'Front, three-quarter, side and back views on one sheet; used for back views and for consistency.',
    attach: ['anchor'],
    imageModel: 'nano_banana',
    modelReason: 'Best at keeping the face identical to a reference.',
    aspect: '16:9',
    tips: ['Check the back view: hair length and style must match the front.', FACE_TIP],
    framing: (first) =>
      `A character turnaround sheet: four full-body views of ${first} side by side on one image, evenly spaced and the same height: front, three-quarter, left side profile and back. She stands in a relaxed neutral pose with her arms slightly away from her body, with the same hairstyle and expression in every view.`,
    outfit: 'full',
    background: 'studio',
  },
  {
    tag: 'base_front',
    purpose: 'Full-body front view; attached to every full-body scene.',
    attach: ['anchor', 'turnaround'],
    imageModel: 'nano_banana',
    modelReason: 'Best at keeping the face identical to a reference.',
    aspect: '9:16',
    tips: [FACE_TIP],
    framing: () =>
      'Full-body photo from head to feet, standing facing the camera with her weight on one leg and her arms relaxed at her sides, looking at the camera with a soft smile. Camera at chest height, about three metres away.',
    outfit: 'full',
    background: 'studio',
  },
  {
    tag: 'base_three_quarter',
    purpose: 'Full-body three-quarter view; attached to three-quarter scenes.',
    attach: ['anchor', 'turnaround'],
    imageModel: 'nano_banana',
    modelReason: 'Best at keeping the face identical to a reference.',
    aspect: '9:16',
    tips: [FACE_TIP],
    framing: () =>
      'Full-body photo from head to feet, her body turned about 45 degrees to her left with her face turned back toward the camera, relaxed natural pose, soft smile. Camera at chest height.',
    outfit: 'full',
    background: 'studio',
  },
  {
    tag: 'base_walk',
    purpose: 'Natural walking pose, for movement in video scenes.',
    attach: ['anchor', 'turnaround'],
    imageModel: 'nano_banana',
    modelReason: 'Best at keeping the face identical to a reference.',
    aspect: '9:16',
    tips: [FACE_TIP],
    framing: () =>
      'Full-body photo of her walking naturally toward the camera mid-stride, arms swinging slightly, relaxed confident expression, head to feet in frame.',
    outfit: 'full',
    background: 'studio',
  },
  {
    tag: 'base_hair_up',
    purpose: 'Hair tied up, neck and shoulders visible; used for halter, saree and backless outfits.',
    attach: ['anchor', 'turnaround'],
    imageModel: 'nano_banana',
    modelReason: 'Best at keeping the face identical to a reference.',
    aspect: '9:16',
    tips: ['Her face must still read as her with the hair up: check the hairline and ears.', FACE_TIP],
    framing: () =>
      'Full-body photo from head to feet, her hair tied up in a neat high bun that leaves her neck and shoulders visible, standing facing the camera with a soft smile.',
    outfit: 'hairUp',
    background: 'studio',
  },
  {
    tag: 'closeup_front',
    purpose: 'Face close-up, front; for close-up and detail scenes.',
    attach: ['anchor'],
    imageModel: 'nano_banana',
    modelReason: 'Best at keeping the face identical to a reference.',
    aspect: '3:4',
    tips: [FACE_TIP],
    framing: () =>
      'Close-up of her face and shoulders, facing the camera straight on at eye level, relaxed neutral expression with her lips gently closed, face filling most of the frame.',
    outfit: 'top',
    background: 'studio',
  },
  {
    tag: 'closeup_left',
    purpose: 'Face close-up, turned to show her left side.',
    attach: ['anchor'],
    imageModel: 'nano_banana',
    modelReason: 'Best at keeping the face identical to a reference.',
    aspect: '3:4',
    tips: [FACE_TIP],
    framing: () =>
      'Close-up of her face and shoulders, her head turned about 45 degrees so the left side of her face is toward the camera, eyes looking toward the camera, relaxed expression.',
    outfit: 'top',
    background: 'studio',
  },
  {
    tag: 'closeup_right',
    purpose: 'Face close-up, turned to show her right side.',
    attach: ['anchor'],
    imageModel: 'nano_banana',
    modelReason: 'Best at keeping the face identical to a reference.',
    aspect: '3:4',
    tips: ['Check asymmetric details (a beauty mark, a parting) are on the correct side.', FACE_TIP],
    framing: () =>
      'Close-up of her face and shoulders, her head turned about 45 degrees so the right side of her face is toward the camera, eyes looking toward the camera, relaxed expression.',
    outfit: 'top',
    background: 'studio',
  },
  {
    tag: 'profile',
    purpose: 'Exact side profile.',
    attach: ['anchor'],
    imageModel: 'nano_banana',
    modelReason: 'Best at keeping the face identical to a reference.',
    aspect: '3:4',
    tips: [FACE_TIP],
    framing: () =>
      'Head-and-shoulders side profile, her face turned exactly 90 degrees to her left so only the left side of her face is visible, neutral relaxed expression, chin level.',
    outfit: 'top',
    background: 'studio',
  },
  {
    tag: 'hands',
    purpose: 'Her hands, nails and any hand or wrist details; for detail and holding scenes.',
    attach: ['anchor'],
    imageModel: 'gpt_image',
    modelReason: 'Most reliable for natural hands and small details.',
    aspect: '3:4',
    tips: ['Count the fingers. Check any wrist or hand feature against its rule.', 'Generate 2–4 variations, upload the best ones and approve one.'],
    framing: () =>
      'Close-up of both her hands held loosely in front of her waist, fingers relaxed and slightly apart, the insides of both wrists turned toward the camera, five natural fingers on each hand, natural short nails, with her chin and shoulders just visible at the top of the frame.',
    outfit: 'top',
    background: 'studio',
  },
  {
    tag: 'lifestyle',
    purpose: 'A candid photo at home in her own clothes; sets the look of unboxing scenes.',
    attach: ['anchor', 'base_front'],
    imageModel: 'nano_banana',
    modelReason: 'Best at keeping the face identical to a reference.',
    aspect: '9:16',
    tips: ['This becomes the look of her bedroom in every unboxing scene: check the setting matches her persona.', FACE_TIP],
    framing: () =>
      'A candid phone photo taken by a friend: she sits relaxed on the edge of her bed, looking at the camera with a warm natural smile, framed from head to knees.',
    outfit: 'home',
    background: 'home',
  },
];

export function frameFor(tag: string): FrameDef | undefined {
  return FRAMES.find((f) => f.tag === tag);
}

export interface CreatorPersona {
  name: string;
  identityBlock: string;
  shortIdentity: string;
  homeOutfit: string;
  homeSetting: string;
  forbiddenFeatures: string[];
  conditionalFeatures: Array<{ feature: string; rule: string }>;
}

function ext(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot) : '.jpg';
}

/** The approved references a frame attaches, in order. */
export function frameAttachments(
  frame: FrameDef,
  persona: Pick<CreatorPersona, 'name'>,
  references: RefCandidate[],
): { attachments: SelectedAttachment[]; missing: string[] } {
  const first = persona.name.split(' ')[0] || persona.name;
  const slug = slugify(first);
  const sorted = [...references].sort((a, b) => a.sortOrder - b.sortOrder);
  const attachments: SelectedAttachment[] = [];
  const missing: string[] = [];
  for (const tag of frame.attach) {
    const ref = sorted.find((r) => r.tags.includes(tag));
    if (!ref) {
      missing.push(
        tag === 'anchor'
          ? `Approve ${first}'s anchor first`
          : `No "${tag.replaceAll('_', ' ')}" yet: approve it first for better consistency, or generate without it`,
      );
      continue;
    }
    const index = attachments.length + 1;
    attachments.push({
      index,
      kind: 'reference',
      id: ref.id,
      path: ref.path,
      label: `${first} ${tag.replaceAll('_', ' ')}`,
      fileName: `${index}_${slug}_${tag}${ext(ref.path)}`,
    });
  }
  return { attachments, missing };
}

export class CreatorPromptError extends Error {}

/** Deterministic frame prompt; the numbering in the intro matches `attachCount`. */
export function buildFramePrompt(frame: FrameDef, persona: CreatorPersona, attachCount: number, prompts: PromptService): string {
  const first = persona.name.split(' ')[0] || persona.name;
  // Mid-sentence after "She is wearing", so the outfit keeps its lowercase article.
  const home = persona.homeOutfit.trim().replace(/[.]+$/, '') || 'her own casual clothes';
  const outfit = frame.outfit === 'home' ? `${home}.` : OUTFITS[frame.outfit];
  const homeSetting = persona.homeSetting.trim().replace(/[.]+$/, '');
  const background = frame.background === 'home' ? sentence(`She is in ${homeSetting || 'her softly lit bedroom'}`) : STUDIO;
  const vars = {
    name: first,
    identityBlock: sentence(persona.identityBlock),
    shortIdentity: sentence(persona.shortIdentity),
    personaRules: personaRules(persona),
    framing: sentence(frame.framing(first)),
    outfit,
    background,
    aspect: frame.aspect,
    intro: attachCount > 0 ? `${personImagesLead(attachCount)} ${first}.` : '',
  };
  const prompt = tidyPrompt(prompts.render(frame.tag === 'anchor' ? 'templates/creator-anchor' : 'templates/creator-frame', vars));
  if (hasPlaceholder(prompt)) throw new CreatorPromptError('The frame prompt contains brackets or a placeholder; check the persona text.');
  return prompt;
}

/** Sentences a rewrite must keep verbatim (identity, persona rules, numbering). */
export function requiredSentences(persona: CreatorPersona, frame: FrameDef, attachCount: number): string[] {
  const first = persona.name.split(' ')[0] || persona.name;
  const required = [personaRules(persona)];
  if (frame.tag === 'anchor') required.push(sentence(persona.identityBlock));
  else required.push(sentence(persona.shortIdentity));
  if (attachCount > 0) required.push(`${personImagesLead(attachCount)} ${first}.`);
  return required.filter(Boolean);
}

/**
 * The frame's current prompt and attachments: rebuilt from the persona on every read (so the
 * numbering follows newly approved references) unless the prompt was edited or rewritten.
 */
export function frameCard(
  task: { tag: string; prompt: string; promptOverride: boolean },
  persona: CreatorPersona,
  references: RefCandidate[],
  prompts: PromptService,
): { frame: FrameDef; prompt: string; attachments: SelectedAttachment[]; missing: string[]; notes: string[] } {
  const frame = frameFor(task.tag);
  if (!frame) throw new Error(`Unknown creator frame "${task.tag}"`);
  const { attachments, missing } = frameAttachments(frame, persona, references);
  const notes: string[] = [];
  let prompt = task.prompt;
  if (task.promptOverride) {
    notes.push('Prompt edited: check the image numbering still matches the attachments.');
  } else {
    try {
      prompt = buildFramePrompt(frame, persona, attachments.length, prompts);
    } catch (error) {
      if (!(error instanceof CreatorPromptError)) throw error;
      prompt = '';
      missing.unshift(error.message);
    }
  }
  return { frame, prompt, attachments, missing, notes };
}
