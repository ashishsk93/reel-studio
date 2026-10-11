import { z } from 'zod';
import { PRICE_MODES } from '../enums.js';

export const SourceUpdateSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  priceMode: z.enum(PRICE_MODES).optional(),
  disclosureLines: z.array(z.string().trim().min(1)).optional(),
  linkNotes: z.string().optional(),
});
export type SourceUpdate = z.infer<typeof SourceUpdateSchema>;
