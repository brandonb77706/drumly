/**
 * What the player hears. Only the click's loudness changes: every click is still scheduled at
 * the same time and still reported, so grading uses the same tempo grid in every mode.
 */
export type ClickMode = 'on' | 'countInOnly' | 'muted';

export const CLICK_MODES: readonly ClickMode[] = ['on', 'countInOnly', 'muted'];

/** Gain multiplier (0 or 1) for one click in a given mode. */
export function clickGain(mode: ClickMode, isCountIn: boolean): number {
  switch (mode) {
    case 'on':
      return 1;
    case 'countInOnly':
      return isCountIn ? 1 : 0;
    case 'muted':
      return 0;
  }
}

export function isClickMode(value: unknown): value is ClickMode {
  return (CLICK_MODES as readonly unknown[]).includes(value);
}
