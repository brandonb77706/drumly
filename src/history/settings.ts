import { readSettings } from './backup';
import type { HistorySettings } from './types';

/** localStorage key for the settings remembered between page loads. */
export const SETTINGS_KEY = 'drumly.settings';

/** The part of Storage used here (localStorage in the app, a fake in tests). */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Settings saved in this browser, or {} (all defaults) when there are none, storage is blocked, or
 * the saved value is damaged. Each field is checked on its own (readSettings), so one bad value
 * falls back to its default without losing the others.
 * `storage` is a function because merely touching window.localStorage can throw when it's blocked.
 */
export function loadSettings(storage: () => SettingsStorage | null): HistorySettings {
  try {
    const raw = storage()?.getItem(SETTINGS_KEY);
    if (!raw) return {};
    return readSettings(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Remember settings in this browser. False if storage is blocked or full (they still apply until reload). */
export function saveSettings(storage: () => SettingsStorage | null, settings: HistorySettings): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
