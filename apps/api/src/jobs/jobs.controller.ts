import { Controller, Get, Param, Post, Query, Sse, type MessageEvent } from '@nestjs/common';
import { interval, map, merge, type Observable } from 'rxjs';
import { JobsService } from './jobs.service';

@Controller()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('jobs')
  list(@Query('projectId') projectId?: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.jobs.list({ projectId, status, limit: limit ? Number(limit) : undefined });
  }

  @Get('jobs/:id')
  get(@Param('id') id: string) {
    return this.jobs.get(id);
  }

  @Post('jobs/:id/retry')
  retry(@Param('id') id: string) {
    return this.jobs.retry(id);
  }

  @Post('jobs/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.jobs.cancel(id);
  }

  /** Server-Sent Events: job progress, optionally filtered to one project. */
  @Sse('events')
  events(@Query('projectId') projectId?: string): Observable<MessageEvent> {
    const updates = this.jobs.stream(projectId).pipe(map((event) => ({ type: 'job', data: event.job }) as MessageEvent));
    const heartbeat = interval(20_000).pipe(map(() => ({ type: 'ping', data: String(Date.now()) }) as MessageEvent));
    return merge(updates, heartbeat);
  }
}
