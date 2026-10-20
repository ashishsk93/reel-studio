import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InstagramAccountUpdateSchema, InstagramConnectSchema, type InstagramAccountUpdate, type InstagramConnectInput } from '@reel/shared';
import { ZodPipe } from '../common/zod';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AutoReplyService } from './auto-reply.service';
import { InstagramService } from './instagram.service';
import { PUBLIC_RENDER_FILES, PublishService } from './publish.service';
import { verifyMediaSignature, verifySignature } from './webhook';

@Controller()
export class InstagramController {
  private readonly logger = new Logger('InstagramWebhook');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly instagram: InstagramService,
    private readonly autoReply: AutoReplyService,
    private readonly publisher: PublishService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ---------- Account ----------

  @Get('instagram')
  status() {
    return this.instagram.status();
  }

  @Put('instagram/connect')
  connect(@Body(new ZodPipe(InstagramConnectSchema)) body: InstagramConnectInput) {
    return this.instagram.connect(body.accessToken);
  }

  @Patch('instagram')
  update(@Body(new ZodPipe(InstagramAccountUpdateSchema)) body: InstagramAccountUpdate) {
    return this.instagram.update(body);
  }

  @Delete('instagram')
  disconnect() {
    return this.instagram.disconnect();
  }

  @Post('instagram/refresh-token')
  refresh() {
    return this.instagram.refreshNow();
  }

  @Post('instagram/poll')
  poll() {
    return this.autoReply.poll(true);
  }

  @Get('instagram/activity')
  activity(@Query('limit') limit?: string) {
    return this.instagram.activity(limit ? Number(limit) || 100 : 100);
  }

  // ---------- Reels and their DMs ----------

  @Get('instagram/reels')
  reels() {
    return this.instagram.reels();
  }

  @Put('instagram/reels/:mediaId/dm')
  @HttpCode(204)
  setDm(@Param('mediaId') mediaId: string, @Body() body: unknown) {
    return this.instagram.setReelDm(mediaId, body);
  }

  @Post('instagram/reels/:mediaId/skip-existing')
  async skipExisting(@Param('mediaId') mediaId: string) {
    return { skipped: await this.instagram.skipExistingComments(mediaId) };
  }

  @Delete('instagram/reels/:mediaId/dm')
  @HttpCode(204)
  clearDm(@Param('mediaId') mediaId: string) {
    return this.instagram.clearReelDm(mediaId);
  }

  // ---------- Publishing ----------

  @Get('projects/:id/instagram')
  forProject(@Param('id') id: string) {
    return this.publisher.forProject(id);
  }

  @Post('projects/:id/instagram')
  publish(@Param('id') id: string, @Body() body: unknown) {
    return this.publisher.start(id, body);
  }

  // ---------- Public: Meta calls these, so they must stay reachable without the login wall ----------

  /** Webhook verification: echo hub.challenge when the verify token matches. */
  @Get('instagram/webhook')
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response): void {
    const expected = this.config.instagram.verifyToken;
    if (mode === 'subscribe' && expected && token === expected) {
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    res.sendStatus(403);
  }

  @Post('instagram/webhook')
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature: string | undefined, @Body() body: unknown) {
    if (!req.rawBody || !verifySignature(req.rawBody, signature, this.config.instagram.appSecret)) {
      throw new ForbiddenException('Bad signature');
    }
    // Answer Meta straight away; DMs go out in the background.
    void this.autoReply.handleWebhook(body).catch((error: unknown) => this.logger.warn(error instanceof Error ? error.message : String(error)));
    return { ok: true };
  }

  /** Signed, expiring link to a render file, for Instagram to download while publishing. */
  @Get('instagram/media/:renderId/:expires/:sig/:file')
  async signedMedia(
    @Param('renderId') renderId: string,
    @Param('expires') expires: string,
    @Param('sig') sig: string,
    @Param('file') file: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!(PUBLIC_RENDER_FILES as readonly string[]).includes(file) || !verifyMediaSignature(this.config.instagram.appSecret, renderId, file, Number(expires), sig)) {
      throw new NotFoundException('File not found');
    }
    const render = await this.prisma.render.findUnique({ where: { id: renderId } });
    const rel = render ? `${render.outputDir}/${file}` : null;
    if (!rel || !(await this.storage.exists(rel))) throw new NotFoundException('File not found');
    res.sendFile(this.storage.abs(rel));
  }
}
