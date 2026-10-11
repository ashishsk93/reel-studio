import type { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';

/** Reads a Json column through a schema, falling back when stored data is malformed. */
export function readJson<T extends z.ZodType>(schema: T, value: unknown, fallback: z.output<T>): z.output<T> {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

/** Narrows plain data to Prisma's Json input type. */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
