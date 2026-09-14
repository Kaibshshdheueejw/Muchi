// MUCHI — pure, testable audio helpers (loudness normalization + quality map).
// Imported by both public/app.js (inlined copy mirror) and test/smoke.mjs.
// These are pure functions: no WebAudio, no DOM, no state. They only compute
// the numeric gains / quality range that the app then applies. Keeping them
// here lets us unit-test the exact values so "Even volume" and "Stream
// quality" behave identically everywhere (previously 0.92 / 0.88 / 0.92 were
// scattered and disagreed, so the same setting sounded different per path).

/** The single source of truth for "Even volume" (loudness normalization).
 *  Returns the multiplier to apply to the user's master volume [0..1].
 *  - on=false  -> raw volume (no change).
 *  - on=true   -> a modest, consistent headroom trim so loud tracks don't
 *                 clip. A fixed trim is deliberately simple and phase-safe on
 *                 the web <audio> path (a true RMS/ReplayGain scan would need
 *                 to decode the whole file first). 0.86 leaves ~1.5 dB of
 *                 headroom across all three call sites. */
export function normalizeGain(on) {
  return on ? 0.86 : 1;
}

/** Master volume -> media element volume, applying normalization once. */
export function volumeFor(volumePct, normalize) {
  const v = Math.max(0, Math.min(100, Number(volumePct) || 0)) / 100;
  return Math.min(1, v * normalizeGain(normalize));
}

/** Map the "Stream quality" pref to a YouTube iframe quality range.
 *  Deliberately excludes 4K ("highres") unless "Highest" is chosen, so the
 *  default does not silently upgrade to an unbounded/expensive stream. */
export function qualityToYtRange(q) {
  if (q === "low") return ["tiny", "medium"];
  if (q === "standard") return ["medium", "hd720"];
  if (q === "highest") return ["hd1080", "highres"];
  return ["hd720", "highres"]; // auto / high
}

/** Quality pref -> display label. */
export function qualityLabel(q) {
  return { low: "Low", standard: "Standard", high: "High", highest: "Highest" }[q] || "High";
}

/** 10-band graphic equalizer ISO frequency center points (Hz) */
export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** Human-readable frequency label */
export function formatEqFreq(f) {
  return f >= 1000 ? `${f / 1000}k` : `${f}`;
}

/** Pre-tuned equalizer presets with exactly 10 bands in dB (-12 to +12) */
export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  dolby_atmos: [3, 2.5, 1.5, 0.5, 1, 2, 3.5, 4, 3.5, 2],
  atmos_cinema: [4, 3, 1.5, 0, 0.5, 1.5, 3, 4, 3, 1.5],
  bass_boost: [6, 5, 3.5, 2, 0, 0, 0, 0, 1, 1],
  vocal_clarity: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  rock: [4.5, 3, 2, 0, -1, 0.5, 2, 3.5, 4, 4.5],
  electronic: [5, 4, 2, 0, -1.5, 1.5, 1, 3, 4.5, 4],
};

/** Clamp equalizer gain to safe, distortion-free range [-12, +12] dB */
export function clampEqGain(val) {
  const n = Number(val);
  if (Number.isNaN(n)) return 0;
  return Math.max(-12, Math.min(12, Math.round(n * 10) / 10));
}

/** Return appropriate BiquadFilterType for band index (0..9) */
export function eqFilterType(bandIdx) {
  if (bandIdx === 0) return "lowshelf";
  if (bandIdx === EQ_FREQS.length - 1) return "highshelf";
  return "peaking";
}

/** Validate and normalize a 10-band array */
export function validateEqBands(bands) {
  if (!Array.isArray(bands) || bands.length !== EQ_FREQS.length) {
    return [...EQ_PRESETS.flat];
  }
  return bands.map(clampEqGain);
}
