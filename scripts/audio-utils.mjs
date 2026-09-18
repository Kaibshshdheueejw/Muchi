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
