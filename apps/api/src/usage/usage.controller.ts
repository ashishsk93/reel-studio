import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { UsageService } from './usage.service';

function parseDate(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${name} must be an ISO date`);
  return date;
}

@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  summary(@Query('from') from?: string, @Query('to') to?: string, @Query('projectId') projectId?: string) {
    return this.usage.summary({ from: parseDate(from, 'from'), to: parseDate(to, 'to'), projectId });
  }
}
