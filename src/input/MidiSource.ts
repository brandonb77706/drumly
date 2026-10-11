import { parseMidiMessage } from './parseMidiMessage';
import type { EmitFn, InputSource } from './types';

export interface MidiSourceOptions {
  /** Called with the names of currently connected MIDI inputs whenever that list changes. */
  onDevicesChange?: (deviceNames: string[]) => void;
  /** Override for tests or non-browser hosts. Defaults to navigator.requestMIDIAccess. */
  requestAccess?: () => Promise<MIDIAccess>;
}

/**
 * Listens to every MIDI input, including devices plugged in after start().
 * Timing comes from MIDIMessageEvent.timeStamp, which is on the performance.now() clock.
 */
export class MidiSource implements InputSource {
  readonly name = 'midi';
  private readonly onDevicesChange: ((names: string[]) => void) | undefined;
  private readonly requestAccess: (() => Promise<MIDIAccess>) | undefined;

  private access: MIDIAccess | null = null;
  private emit: EmitFn | null = null;
  /** Inputs we have attached a handler to, by port id. */
  private readonly attached = new Map<string, MIDIInput>();
  private lastReportedNames = '';
  /** Bumped on stop() so a slow permission prompt can't resurrect a stopped source. */
  private generation = 0;

  constructor(options: MidiSourceOptions = {}) {
    this.onDevicesChange = options.onDevicesChange;
    this.requestAccess = options.requestAccess;
  }

  async start(emit: EmitFn): Promise<void> {
    this.stop();
    const generation = this.generation;

    const request =
      this.requestAccess ??
      (typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
        ? () => navigator.requestMIDIAccess({ sysex: false })
        : undefined);
    if (!request) throw new Error('Web MIDI is not supported in this browser (try Chrome or Edge)');

    const access = await request();
    if (generation !== this.generation) return; // stopped while waiting for permission

    this.access = access;
    this.emit = emit;
    access.onstatechange = this.refreshInputs;
    this.refreshInputs();
  }

  stop(): void {
    this.generation++;
    for (const input of this.attached.values()) input.onmidimessage = null;
    this.attached.clear();
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.emit = null;
    this.reportDevices([]);
  }

  /** Sync handlers with the current set of connected inputs. Safe to call repeatedly. */
  private readonly refreshInputs = (): void => {
    const access = this.access;
    if (!access) return;

    const connected = new Map<string, MIDIInput>();
    for (const input of access.inputs.values()) {
      if (input.state === 'connected') connected.set(input.id, input);
    }

    for (const [id, input] of this.attached) {
      if (connected.get(id) !== input) {
        input.onmidimessage = null;
        this.attached.delete(id);
      }
    }
    for (const [id, input] of connected) {
      if (!this.attached.has(id)) {
        // Assigning onmidimessage also implicitly opens the port.
        input.onmidimessage = this.onMessage;
        this.attached.set(id, input);
      }
    }

    this.reportDevices([...connected.values()].map((i) => i.name ?? i.id));
  };

  private readonly onMessage = (event: MIDIMessageEvent): void => {
    const hit = parseMidiMessage(event.data, event.timeStamp);
    if (hit) this.emit?.(hit);
  };

  private reportDevices(names: string[]): void {
    const unique = [...new Set(names)];
    const key = unique.join('\u0000');
    if (key === this.lastReportedNames) return;
    this.lastReportedNames = key;
    this.onDevicesChange?.(unique);
  }
}
