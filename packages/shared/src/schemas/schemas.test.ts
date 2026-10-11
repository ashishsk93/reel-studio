import { describe, expect, it } from 'vitest';
import { SETTINGS, SETTING_KEYS } from '../settings.js';
import {
  CreatorBriefSchema,
  InfluencerCreateSchema,
  ReferenceUploadFieldsSchema,
} from './influencer.js';
import { PersonaOutputSchema } from '../llm/persona.js';

const aanya = {
  name: 'Aanya Kapoor',
  age: 22,
  city: 'South Delhi',
  identityBlock: 'Aanya Kapoor, a 22-year-old Punjabi woman…',
  shortIdentity: 'curly dark-brown hair with curtain bangs…',
  voiceNotes: 'bold, witty Hinglish',
  exampleLines: ['Main character, sorted 💅'],
  personality: 'confident',
  lane: 'festive glam',
  hashtag: '#AanyaPicks',
  signatureDetails: ['cherry-red lip tint'],
  forbiddenFeatures: ['no nose ring or nose piercing'],
  conditionalFeatures: [{ feature: 'crescent-moon tattoo', rule: 'inside left wrist only when visible' }],
  defaultStyling: '',
  homeOutfit: 'oversized white t-shirt',
  homeSetting: 'cosy Delhi bedroom',
};

describe('InfluencerCreateSchema', () => {
  it('accepts a full influencer and defaults status to active', () => {
    const parsed = InfluencerCreateSchema.parse(aanya);
    expect(parsed.status).toBe('active');
  });

  it('rejects minors, bad hashtags and empty rules', () => {
    expect(InfluencerCreateSchema.safeParse({ ...aanya, age: 17 }).success).toBe(false);
    expect(InfluencerCreateSchema.safeParse({ ...aanya, hashtag: 'AanyaPicks' }).success).toBe(false);
    expect(InfluencerCreateSchema.safeParse({ ...aanya, forbiddenFeatures: [''] }).success).toBe(false);
    expect(InfluencerCreateSchema.safeParse({ ...aanya, slug: 'Aanya K' }).success).toBe(false);
  });
});

describe('ReferenceUploadFieldsSchema', () => {
  it('parses JSON and comma-separated tags', () => {
    expect(ReferenceUploadFieldsSchema.parse({ tags: '["anchor","hands"]' }).tags).toEqual(['anchor', 'hands']);
    expect(ReferenceUploadFieldsSchema.parse({ tags: 'anchor, profile' }).tags).toEqual(['anchor', 'profile']);
    expect(ReferenceUploadFieldsSchema.parse({}).tags).toEqual([]);
  });

  it('rejects unknown tags', () => {
    expect(ReferenceUploadFieldsSchema.safeParse({ tags: 'anchor,selfie' }).success).toBe(false);
  });
});

describe('CreatorBriefSchema', () => {
  it('requires the core brief fields', () => {
    expect(CreatorBriefSchema.safeParse({ age: 24 }).success).toBe(false);
    const ok = CreatorBriefSchema.parse({
      age: 24,
      city: 'Jaipur',
      lane: 'block prints',
      vibe: 'sunny',
      voiceLanguage: 'Hinglish',
    });
    expect(ok.mustAvoid).toBe('');
  });
});

describe('PersonaOutputSchema', () => {
  it('matches the influencer fields shape', () => {
    const persona = PersonaOutputSchema.parse(aanya);
    expect(InfluencerCreateSchema.safeParse(persona).success).toBe(true);
  });
});

describe('SETTINGS defaults', () => {
  it.each(SETTING_KEYS)('%s default satisfies its schema', (key) => {
    const setting = SETTINGS[key];
    expect(setting.schema.safeParse(setting.default).success).toBe(true);
  });
});
