// Tiny synthesized UI sounds (no audio files): a soft tick when moving, a chirp when selecting.
let ctx = null;
let enabled = localStorage.getItem("phosphor.sounds") !== "off";

function tone(freqs, { type = "sine", dur = 0.05, gain = 0.035, gap = 0.035 } = {}) {
  if (!enabled) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    let t = ctx.currentTime;
    for (const f of freqs) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
      t += gap;
    }
  } catch { /* audio unavailable */ }
}

export const sound = {
  play(name) {
    if (name === "move") tone([1320], { dur: 0.03, gain: 0.018 });
    else if (name === "select") tone([880, 1320], { type: "triangle", dur: 0.07, gain: 0.03 });
    else if (name === "back") tone([990, 660], { type: "triangle", dur: 0.07, gain: 0.025 });
    else if (name === "error") tone([220, 180], { type: "square", dur: 0.09, gain: 0.02, gap: 0.07 });
    else if (name === "success") tone([660, 880, 1320], { type: "triangle", dur: 0.1, gain: 0.03, gap: 0.06 });
  },
  set(on) { enabled = !!on; localStorage.setItem("phosphor.sounds", on ? "on" : "off"); },
  get enabled() { return enabled; },
};
