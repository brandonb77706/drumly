/**
 * Web Worker that only posts "tick" messages. It never plays sound: clicks are
 * scheduled on the AudioContext clock. Worker timers keep running at full rate when
 * the tab is in the background, unlike main-thread timers.
 */
type TickerCommand = { type: 'start'; intervalMs: number } | { type: 'stop' };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<TickerCommand>) => void) | null;
  postMessage(message: unknown): void;
};

let timer: ReturnType<typeof setInterval> | null = null;

scope.onmessage = (event) => {
  if (timer !== null) clearInterval(timer);
  timer = null;
  if (event.data.type === 'start') {
    timer = setInterval(() => scope.postMessage('tick'), event.data.intervalMs);
  }
};
