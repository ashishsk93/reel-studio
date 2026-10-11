import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export function zodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({ message: 'Validation failed', issues: zodIssues(result.error) });
  }
  return result.data;
}

/** `@Body(new ZodPipe(Schema)) body: z.output<typeof Schema>` */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    return parseOrThrow(this.schema, value);
  }
}
