import { Injectable } from '@nestjs/common';
import {
  SETTINGS,
  SETTING_KEYS,
  type SettingKey,
  type SettingValue,
  type SettingsMap,
} from '@reel/shared';
import { parseOrThrow } from '../common/zod';
import { toJson } from '../common/json';
import { PrismaService } from '../prisma/prisma.service';

/** Settings live in the Setting table; anything unset or invalid falls back to the shared default. */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return this.resolve(key, row?.value);
  }

  async getAll(): Promise<SettingsMap> {
    const rows = await this.prisma.setting.findMany();
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    return Object.fromEntries(SETTING_KEYS.map((key) => [key, this.resolve(key, stored.get(key))])) as SettingsMap;
  }

  async set<K extends SettingKey>(key: K, value: unknown): Promise<SettingValue<K>> {
    const parsed = parseOrThrow(SETTINGS[key].schema, value) as SettingValue<K>;
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: toJson(parsed) },
      update: { value: toJson(parsed) },
    });
    return parsed;
  }

  async reset(key: SettingKey): Promise<SettingValue<typeof key>> {
    await this.prisma.setting.deleteMany({ where: { key } });
    return SETTINGS[key].default as SettingValue<typeof key>;
  }

  private resolve<K extends SettingKey>(key: K, stored: unknown): SettingValue<K> {
    const setting = SETTINGS[key];
    if (stored !== undefined) {
      const parsed = setting.schema.safeParse(stored);
      if (parsed.success) return parsed.data as SettingValue<K>;
    }
    return setting.default as SettingValue<K>;
  }
}
