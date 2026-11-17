// Soft two-note chime synthesized with WebAudio — no audio files shipped.
let ctx;
export function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* unsupported */ }
}
export function chime(volume = 0.6) {
  try {
    unlockAudio();
    if (!ctx || ctx.state !== 'running') return false;
    const t0 = ctx.currentTime + 0.02, master = ctx.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume)) * 0.35;
    master.connect(ctx.destination);
    [[1046.5, 0], [1318.5, 0.16]].forEach(([f, dt]) => {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 2; // soft bell partial
      const g2 = ctx.createGain(); g2.gain.value = 0.12;
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(master);
      const s = t0 + dt;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(1, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 1.1);
      o.start(s); o2.start(s); o.stop(s + 1.2); o2.stop(s + 1.2);
    });
    return true;
  } catch { return false; }
}
