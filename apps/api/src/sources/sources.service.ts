import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { PRICE_MODES, SOURCES, SOURCE_KEYS, type SourceDto, type SourceUpdate } from '@reel/shared';
import type { Source } from '../generated/prisma/client';
import { readJson, toJson } from '../common/json';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { inspectImage } from '../storage/uploads';

@Injectable()
export class SourcesService implements OnModuleInit {
  private readonly log = new Logger(SourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Creates a row for each store in the registry that has none yet; existing rows keep their edits. */
  async onModuleInit(): Promise<void> {
    const existing = new Set((await this.prisma.source.findMany({ select: { key: true } })).map((r) => r.key));
    for (const s of SOURCES) {
      if (existing.has(s.key)) continue;
      await this.prisma.source.create({
        data: { key: s.key, displayName: s.displayName, priceMode: s.priceMode, disclosureLines: toJson([...s.disclosureLines]), linkNotes: s.linkNotes },
      });
      this.log.log(`Added store ${s.displayName}`);
    }
  }

  async list(): Promise<SourceDto[]> {
    const rows = await this.prisma.source.findMany();
    const order = (key: string) => SOURCE_KEYS.indexOf(key as (typeof SOURCE_KEYS)[number]);
    return rows.sort((a, b) => order(a.key) - order(b.key)).map((r) => this.toDto(r));
  }

  async update(id: string, data: SourceUpdate): Promise<SourceDto> {
    await this.find(id);
    const row = await this.prisma.source.update({
      where: { id },
      data: {
        ...data,
        disclosureLines: data.disclosureLines ? toJson(data.disclosureLines) : undefined,
      },
    });
    return this.toDto(row);
  }

  async setLogo(id: string, file: Express.Multer.File | undefined): Promise<SourceDto> {
    try {
      const source = await this.find(id);
      if (!file) throw new BadRequestException('Attach a logo image.');
      const info = await inspectImage(file.path, file.originalname);
      if (info.format === 'jpeg') {
        throw new BadRequestException('Use a PNG or WebP logo with a transparent background (JPEG has no transparency).');
      }
      // New filename per upload so cached URLs never show the old logo.
      const rel = `sources/${source.key}/logo-${Date.now()}.${info.ext}`;
      await this.storage.moveInto(file.path, rel);
      const row = await this.prisma.source.update({ where: { id }, data: { logoPath: rel } });
      await this.storage.remove(source.logoPath);
      return this.toDto(row);
    } finally {
      await this.storage.discardTemp(file?.path);
    }
  }

  async removeLogo(id: string): Promise<SourceDto> {
    const source = await this.find(id);
    const row = await this.prisma.source.update({ where: { id }, data: { logoPath: null } });
    await this.storage.remove(source.logoPath);
    return this.toDto(row);
  }

  private async find(id: string): Promise<Source> {
    const row = await this.prisma.source.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Source not found');
    return row;
  }

  private toDto(row: Source): SourceDto {
    return {
      id: row.id,
      key: readJson(z.enum(SOURCE_KEYS), row.key, 'amazon'),
      displayName: row.displayName,
      logoUrl: this.storage.url(row.logoPath),
      priceMode: readJson(z.enum(PRICE_MODES), row.priceMode, 'exact'),
      disclosureLines: readJson(z.array(z.string()), row.disclosureLines, []),
      linkNotes: row.linkNotes,
    };
  }
}
