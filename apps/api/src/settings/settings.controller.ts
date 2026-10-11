import { Body, Controller, Delete, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { SETTINGS, SETTING_KEYS, isSettingKey, type SettingKey } from '@reel/shared';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async all() {
    const values = await this.settings.getAll();
    return SETTING_KEYS.map((key) => ({
      key,
      label: SETTINGS[key].label,
      value: values[key],
      default: SETTINGS[key].default,
    }));
  }

  @Put(':key')
  async update(@Param('key') key: string, @Body() body: { value: unknown }) {
    return { key, value: await this.settings.set(this.key(key), body?.value) };
  }

  @Delete(':key')
  async reset(@Param('key') key: string) {
    return { key, value: await this.settings.reset(this.key(key)) };
  }

  private key(key: string): SettingKey {
    if (!isSettingKey(key)) throw new NotFoundException(`Unknown setting "${key}"`);
    return key;
  }
}
