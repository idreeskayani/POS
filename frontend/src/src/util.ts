export const fmt = (n: number, currency = 'PKR') =>
  `${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const uuid = (): string =>
  (globalThis.crypto as any)?.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export const minutesSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function beep() {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; gain.gain.value = 0.15;
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 350);
  } catch { /* sound is optional */ }
}
