// 提示音與震動（F-CHK-6）。iOS 要在使用者操作當下建立或恢復 AudioContext，之後才能出聲
import type { ScanStatus } from './scanRecord';

/** [頻率, 長度秒, 起始秒] */
const SOUNDS: Record<ScanStatus, Array<[number, number, number]>> = {
  ok: [[880, 0.15, 0]],
  dup: [[660, 0.12, 0], [660, 0.12, 0.2]],
  error: [[220, 0.5, 0]],
  queued: [[880, 0.15, 0]],
};
const VIB: Record<ScanStatus, number[]> = { ok: [80], dup: [80, 80, 80], error: [300], queued: [80] };

let actx: AudioContext | null = null;

function audio(): AudioContext {
  if (!actx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    actx = new Ctor();
  }
  if (actx.state !== 'running') actx.resume().catch(() => {});
  return actx;
}

/** 在點擊或按鍵的事件處理中呼叫 */
export function primeAudio() {
  try {
    audio();
  } catch {
    // 不支援 Web Audio 時靜音
  }
}

export function feedback(status: ScanStatus) {
  try {
    const a = audio();
    const t0 = a.currentTime;
    for (const [f, d, at] of SOUNDS[status]) {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.3, t0 + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + d);
      o.connect(g);
      g.connect(a.destination);
      o.start(t0 + at);
      o.stop(t0 + at + d + 0.02);
    }
  } catch {
    // 不支援 Web Audio 時靜音
  }
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(VIB[status]);
  } catch {
    // iOS 沒有震動 API
  }
}
