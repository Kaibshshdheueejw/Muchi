// MUCHI — Phase 2.0 Advanced Search Accuracy, Coverage & Matching Tests
import assert from "node:assert/strict";
import {
  detectVersionType,
  detectQueryIntent,
  generateTargetedQueryVariations,
  computeRecordingDedupeKey,
  rankTracksByVersionIntent,
  normalizeIsrc,
  extractIsrcFromText,
} from "../src/util.js";
import { strictSongs } from "../src/parse.js";

console.log("Running Phase 2.0 Search Accuracy & Deduplication Tests...\n");

// 1. Version Detection
console.log("1. Testing detectVersionType...");
assert.equal(detectVersionType("Hotel California (Live at The Forum)"), "live");
assert.equal(detectVersionType("Hotel California", "Live Concert Band"), "live");
assert.equal(detectVersionType("Blinding Lights (Major Lazer Remix)"), "remix");
assert.equal(detectVersionType("Blinding Lights - Extended Club Mix"), "remix");
assert.equal(detectVersionType("Someone Like You (Acoustic Version)"), "acoustic");
assert.equal(detectVersionType("Someone Like You - Unplugged"), "acoustic");
assert.equal(detectVersionType("Shape of You (Instrumental)"), "instrumental");
assert.equal(detectVersionType("Shape of You - Karaoke Version"), "karaoke");
assert.equal(detectVersionType("Yesterday (Cover by John)"), "cover");
assert.equal(detectVersionType("Yesterday - Tribute to The Beatles"), "cover");
assert.equal(detectVersionType("Stay (Sped Up)"), "speed_up");
assert.equal(detectVersionType("Stay (Slowed + Reverb)"), "slowed");
assert.equal(detectVersionType("Levitating (Radio Edit)"), "radio_edit");
assert.equal(detectVersionType("Levitating (Album Version)"), "radio_edit");
assert.equal(detectVersionType("Blinding Lights", "The Weeknd"), "studio");
console.log("  ✓ detectVersionType handles all version types accurately");

// 2. Query Intent Detection
console.log("2. Testing detectQueryIntent...");
const liveIntent = detectQueryIntent("hotel california live");
assert.equal(liveIntent.requestedVersion, "live");
assert.equal(liveIntent.cleanQuery, "hotel california");

const remixIntent = detectQueryIntent("blinding lights remix");
assert.equal(remixIntent.requestedVersion, "remix");
assert.equal(remixIntent.cleanQuery, "blinding lights");

const acousticIntent = detectQueryIntent("someone like you acoustic");
assert.equal(acousticIntent.requestedVersion, "acoustic");
assert.equal(acousticIntent.cleanQuery, "someone like you");

const standardIntent = detectQueryIntent("blinding lights the weeknd");
assert.equal(standardIntent.requestedVersion, null);
assert.equal(standardIntent.cleanQuery, "blinding lights the weeknd");
console.log("  ✓ detectQueryIntent accurately identifies requested recording versions");

// 3. Targeted Query Variations
console.log("3. Testing generateTargetedQueryVariations...");
const varsFeat = generateTargetedQueryVariations("Unholy (feat. Kim Petras)");
assert.ok(varsFeat.includes("Unholy") || varsFeat.some(v => !v.includes("Kim Petras")));

const varsPunct = generateTargetedQueryVariations("Don't Stop Believin'");
assert.ok(varsPunct.some(v => !v.includes("'")));

const varsDash = generateTargetedQueryVariations("Adele - Hello");
assert.ok(varsDash.includes("Hello Adele"));

assert.ok(varsFeat.length <= 2);
console.log("  ✓ generateTargetedQueryVariations generates high-value bounded variations");

// 4. Conservative Recording Deduplication (computeRecordingDedupeKey)
console.log("4. Testing computeRecordingDedupeKey...");
// Tier 1: ISRC matching
const trackA = { title: "Blinding Lights", artist: "The Weeknd", duration: 200, isrc: "USUM71900764" };
const trackB = { title: "Blinding Lights (Official Video)", artist: "The Weeknd", duration: 202, isrc: "US-UM7-19-00764" };
assert.equal(computeRecordingDedupeKey(trackA), computeRecordingDedupeKey(trackB));

// Conflicting ISRCs must NEVER match
const trackConf1 = { title: "Song A", artist: "Artist", duration: 200, isrc: "USUM71900764" };
const trackConf2 = { title: "Song A", artist: "Artist", duration: 200, isrc: "GBAYE0601477" };
assert.notEqual(computeRecordingDedupeKey(trackConf1), computeRecordingDedupeKey(trackConf2));

// Tier 2: Non-ISRC matching (same song + artist + version + duration within 3s bucket)
const trackC = { title: "Rolling in the Deep", artist: "Adele", duration: 228 };
const trackD = { title: "Rolling in the Deep (Official Audio)", artist: "Adele", duration: 229 };
assert.equal(computeRecordingDedupeKey(trackC), computeRecordingDedupeKey(trackD));

// Legitimate Alternate Versions must NEVER merge!
const trackStudio = { title: "Hotel California", artist: "Eagles", duration: 390 };
const trackLive = { title: "Hotel California (Live at The Forum)", artist: "Eagles", duration: 420 };
const trackAcoustic = { title: "Hotel California (Acoustic)", artist: "Eagles", duration: 385 };
assert.notEqual(computeRecordingDedupeKey(trackStudio), computeRecordingDedupeKey(trackLive));
assert.notEqual(computeRecordingDedupeKey(trackStudio), computeRecordingDedupeKey(trackAcoustic));
assert.notEqual(computeRecordingDedupeKey(trackLive), computeRecordingDedupeKey(trackAcoustic));

// Missing duration tracks must not merge arbitrarily
const trackNoDur1 = { id: "yt:1", title: "Some Track", artist: "Singer", duration: 0 };
const trackNoDur2 = { id: "yt:2", title: "Some Track", artist: "Singer", duration: 0 };
assert.notEqual(computeRecordingDedupeKey(trackNoDur1), computeRecordingDedupeKey(trackNoDur2));
console.log("  ✓ computeRecordingDedupeKey is strictly conservative (ISRC tier 1, version/duration tier 2)");

// 5. strictSongs deduplication & enrichment
console.log("5. Testing strictSongs deduplication & enrichment...");
const dupList = [
  { id: "apple:1", title: "Song", artist: "Singer", duration: 180, isrc: "USUM71900764", album: "" },
  { id: "deezer:2", title: "Song", artist: "Singer", duration: 180, isrc: "USUM71900764", album: "Hit Album" },
  { id: "apple:3", title: "Song (Live)", artist: "Singer", duration: 210, isrc: "USUM71900765" },
];
const deduped = strictSongs(dupList);
assert.equal(deduped.length, 2); // 1 studio merged + 1 live preserved
assert.equal(deduped[0].album, "Hit Album"); // Enriched from Deezer
assert.equal(deduped[1].title, "Song (Live)"); // Live version kept separate
console.log("  ✓ strictSongs merges duplicates, enriches fields, and preserves alternate versions");

// 6. Version Intent Ranking
console.log("6. Testing rankTracksByVersionIntent...");
const candidates = [
  { title: "Hotel California (Live)", artist: "Eagles", id: "live" },
  { title: "Hotel California", artist: "Eagles", id: "studio" },
  { title: "Hotel California (Remix)", artist: "Eagles", id: "remix" },
];

// Ordinary search: studio ranks first
const rankedStandard = rankTracksByVersionIntent(candidates, "hotel california eagles");
assert.equal(rankedStandard[0].id, "studio");

// Explicit "live" search: live ranks first
const rankedLive = rankTracksByVersionIntent(candidates, "hotel california live");
assert.equal(rankedLive[0].id, "live");

// Explicit "remix" search: remix ranks first
const rankedRemix = rankTracksByVersionIntent(candidates, "hotel california remix");
assert.equal(rankedRemix[0].id, "remix");
console.log("  ✓ rankTracksByVersionIntent ranks official first for standard queries and requested version first for targeted queries");

console.log("\nALL PHASE 2.0 TESTS PASSED SUCCESSFULLY! ✓");
