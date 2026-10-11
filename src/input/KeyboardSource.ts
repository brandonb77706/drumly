import { KEYBOARD_CODE_TO_PAD } from './padMaps';
import type { EmitFn, InputSource, Pad } from './types';

export const KEYBOARD_NORMAL_VELOCITY = 90;
export const KEYBOARD_ACCENT_VELOCITY = 127;

export interface KeyboardSourceOptions {
  /** Where to listen. Defaults to window. */
  target?: EventTarget;
  /** Key map override. Defaults to KEYBOARD_CODE_TO_PAD. */
  keyMap?: ReadonlyMap<string, Pad>;
}

/**
 * Turns keydown events into hits.
 * Shift held = accent (127), otherwise 90. Key auto-repeat is ignored.
 * Timing comes from KeyboardEvent.timeStamp, which is on the performance.now() clock.
 */
export class KeyboardSource implements InputSource {
  readonly name = 'keyboard';
  private readonly target: EventTarget | undefined;
  private readonly keyMap: ReadonlyMap<string, Pad>;
  private emit: EmitFn | null = null;
  private boundTarget: EventTarget | null = null;

  constructor(options: KeyboardSourceOptions = {}) {
    this.target = options.target;
    this.keyMap = options.keyMap ?? KEYBOARD_CODE_TO_PAD;
  }

  start(emit: EmitFn): void {
    const target = this.target ?? (typeof window !== 'undefined' ? window : undefined);
    if (!target) throw new Error('No window to listen for key events on');
    this.stop();
    this.emit = emit;
    this.boundTarget = target;
    target.addEventListener('keydown', this.onKeyDown);
  }

  stop(): void {
    this.boundTarget?.removeEventListener('keydown', this.onKeyDown);
    this.boundTarget = null;
    this.emit = null;
  }

  private readonly onKeyDown = (event: Event): void => {
    const e = event as KeyboardEvent;
    // Leave browser/OS shortcuts (Cmd+R, Ctrl+L, ...) alone.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditableTarget(e.target)) return;

    const pad = this.keyMap.get(e.code);
    if (pad === undefined) return;

    // Stop Space scrolling the page (and mapped keys triggering anything else),
    // including on repeats so a held key doesn't scroll either.
    e.preventDefault();
    if (e.repeat) return;

    this.emit?.({
      pad,
      velocity: e.shiftKey ? KEYBOARD_ACCENT_VELOCITY : KEYBOARD_NORMAL_VELOCITY,
      time: e.timeStamp,
      source: 'keyboard',
    });
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
