import { describe, expect, it } from 'vitest';
import { SETTINGS_KEY, loadSettings, saveSettings, type SettingsStorage } from './settings';
import type { HistorySettings } from './types';

function memory(initial: Record<string, string> = {}): SettingsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const blocked: SettingsStorage = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('quota', 'QuotaExceededError');
  },
};

const full: HistorySettings = {
  clickMode: 'countInOnly',
  hitSounds: 'all',
  drumsVolume: 60,
  clickVolume: 35,
  guideDrums: true,
  coachSpeak: false,
  speed: 0.75,
  lessonId: 'fill-2',
  loop: true,
  trainer: true,
  listen: false,
  trainerStepBpm: 4,
  trainerPassThreshold: 85,
  trainerPassesNeeded: 3,
  tab: 'progress',
  progressLesson: 'rock-1',
};

describe('settings between page loads', () => {
  it('save then load gives the same settings', () => {
    const store = memory();
    expect(saveSettings(() => store, full)).toBe(true);
    expect(JSON.parse(store.data[SETTINGS_KEY]!)).toEqual(full);
    expect(loadSettings(() => store)).toEqual(full);
    // The Progress list (no lesson open) is kept as null.
    saveSettings(() => store, { ...full, progressLesson: null });
    expect(loadSettings(() => store).progressLesson).toBeNull();
  });

  it('nothing saved: all defaults', () => {
    expect(loadSettings(() => memory())).toEqual({});
    expect(loadSettings(() => null)).toEqual({});
  });

  it('a damaged value falls back to defaults', () => {
    expect(loadSettings(() => memory({ [SETTINGS_KEY]: '{"clickMode":"off",' }))).toEqual({});
    expect(loadSettings(() => memory({ [SETTINGS_KEY]: '"just a string"' }))).toEqual({});
    expect(loadSettings(() => memory({ [SETTINGS_KEY]: 'null' }))).toEqual({});
    expect(loadSettings(() => memory({ [SETTINGS_KEY]: '[1,2]' }))).toEqual({});
  });

  it('each bad field falls back on its own; the good ones are kept', () => {
    const raw = {
      ...full,
      drumsVolume: 400,
      clickVolume: 'loud',
      speed: -1,
      loop: 'yes',
      trainerPassesNeeded: 0,
      tab: 'settings',
      progressLesson: 42,
      unknown: true,
    };
    const loaded = loadSettings(() => memory({ [SETTINGS_KEY]: JSON.stringify(raw) }));
    expect(loaded).toEqual({
      clickMode: 'countInOnly',
      hitSounds: 'all',
      guideDrums: true,
      coachSpeak: false,
      lessonId: 'fill-2',
      trainer: true,
      listen: false,
      trainerStepBpm: 4,
      trainerPassThreshold: 85,
    });
  });

  it('blocked storage never throws: load gives defaults, save says it failed', () => {
    expect(loadSettings(() => blocked)).toEqual({});
    expect(saveSettings(() => blocked, full)).toBe(false);
    const throwing = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(loadSettings(throwing)).toEqual({});
    expect(saveSettings(throwing, full)).toBe(false);
  });
});
