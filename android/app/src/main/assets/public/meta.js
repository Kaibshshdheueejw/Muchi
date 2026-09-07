/* MUCHI — real audio metadata (ID3v2 + MP4 ilst) for downloaded files.
 *
 * Spotube writes ID3/MP4 tags into downloads via metadata_god so any music
 * app shows title/artist/album/cover. This is the browser-safe equivalent
 * (no Buffer, no Node), used by the web/PWA download path so saved files are
 * truly tagged. The native shells mirror the same frames on Android/iOS.
 *
 *   window.MuchiMeta.embed(u8, ext, meta) -> Uint8Array
 *   window.MuchiMeta.read(u8) -> { container,title,artist,album,genre,picture }
 */
(function (g) {
  "use strict";
  var TextEncoderC = g.TextEncoder || function () { return { encode: function (s) { var a = []; for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 0xff); return new Uint8Array(a); } }; };
  var TextDecoderC = g.TextDecoder || function () { return { decode: function (b) { var s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; } }; };

  function u32be(n) { return [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function u16be(n) { return [(n >> 8) & 255, n & 255]; }
  function utf8(s) { return new TextEncoderC().encode(String(s == null ? "" : s)); }
  function utf8str(b) { return new TextDecoderC().decode(b); }
  function latin(s) { var t = String(s == null ? "" : s); var a = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) a[i] = t.charCodeAt(i) & 0xff; return a; }
  function latinstr(b) { var s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; }
  function utf16le(s) {
    var t = String(s == null ? "" : s); var a = new Uint8Array(t.length * 2);
    for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); a[i * 2] = c & 255; a[i * 2 + 1] = (c >> 8) & 255; }
    return a;
  }
  function utf16lestr(b) { var s = ""; for (var i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] & 255) | ((b[i + 1] & 255) << 8)); return s; }
  function concat() { var n = 0, i, a; for (i = 0; i < arguments.length; i++) n += arguments[i].length; var out = new Uint8Array(n), o = 0; for (i = 0; i < arguments.length; i++) { a = arguments[i]; out.set(a, o); o += a.length; } return out; }
  function u8slice(ar, s, e) { return ar.subarray(s, e == null ? ar.length : e); }

  function findId3v2Size(b) {
    if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
    var sz = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    return 10 + sz;
  }

  function textFrame(id, value) {
    var payload = concat(new Uint8Array([0x03]), utf8(value));
    var f = new Uint8Array(10 + payload.length);
    f.set(latin(id), 0); f.set(u32be(payload.length), 4); f.set(payload, 10);
    return f;
  }
  function apicFrame(mime, data) {
    var md = data || new Uint8Array(0);
    var mimeBytes = latin(mime || "image/jpeg"), desc = latin("cover");
    var payload = new Uint8Array(1 + mimeBytes.length + 1 + 1 + desc.length + 1 + md.length);
    var o = 0; payload[o++] = 0x03; payload.set(mimeBytes, o); o += mimeBytes.length;
    payload[o++] = 0; payload[o++] = 0x03; payload.set(desc, o); o += desc.length;
    payload[o++] = 0; payload.set(md, o); o += md.length;
    var f = new Uint8Array(10 + payload.length);
    f.set(latin("APIC"), 0); f.set(u32be(payload.length), 4); f.set(payload, 10);
    return f;
  }
  function id3v2Tag(audio, meta) {
    meta = meta || {};
    var frames = [];
    if (meta.title) frames.push(textFrame("TIT2", meta.title));
    if (meta.artist) frames.push(textFrame("TPE1", meta.artist));
    if (meta.album) frames.push(textFrame("TALB", meta.album));
    if (meta.genre) frames.push(textFrame("TCON", meta.genre));
    if (meta.picture && meta.picture.data && meta.picture.data.length) frames.push(apicFrame(meta.picture.mime, meta.picture.data));
    var bodyLen = 0, i; for (i = 0; i < frames.length; i++) bodyLen += frames[i].length;
    var header = new Uint8Array(10);
    header.set(latin("ID3"), 0); header[3] = 3; header[4] = 0; header[5] = 0;
    header[6] = ((bodyLen >> 21) & 0x7f); header[7] = ((bodyLen >> 14) & 0x7f); header[8] = ((bodyLen >> 7) & 0x7f); header[9] = (bodyLen & 0x7f);
    var out = new Uint8Array(10 + bodyLen + audio.length);
    out.set(header, 0); var o = 10;
    for (i = 0; i < frames.length; i++) { out.set(frames[i], o); o += frames[i].length; }
    out.set(audio, o);
    return out;
  }
  function readId3v2(bytes) {
    if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
    var total = findId3v2Size(bytes), out = { container: "mp3", title: "", artist: "", album: "", genre: "", picture: null };
    var o = 10, end = Math.min(bytes.length, total);
    while (o + 10 <= end) {
      var id = latinstr(u8slice(bytes, o, o + 4));
      var size = ((bytes[o + 4] << 24) | (bytes[o + 5] << 16) | (bytes[o + 6] << 8) | bytes[o + 7]) >>> 0;
      var dataStart = o + 10, dataEnd = dataStart + size;
      if (dataEnd > bytes.length) break;
      var data = u8slice(bytes, dataStart, dataEnd);
      if (id === "TIT2" || id === "TPE1" || id === "TALB" || id === "TCON") {
        var text = "";
        var raw = u8slice(data, 1);
        if (data[0] === 3) text = utf8str(raw);
        else if (data[0] === 1) text = utf16lestr(raw);
        else text = latinstr(raw);
        if (id === "TIT2") out.title = text; else if (id === "TPE1") out.artist = text; else if (id === "TALB") out.album = text; else out.genre = text;
      } else if (id === "APIC") {
        var p = 1, mime = "";
        while (p < data.length && data[p] !== 0) { mime += String.fromCharCode(data[p]); p++; }
        p++; var type = data[p]; p++;
        while (p < data.length && data[p] !== 0) p++;
        p++;
        out.picture = { mime: mime || "image/jpeg", data: u8slice(data, p) };
      }
      o = dataEnd;
    }
    return out;
  }

  // ── MP4 box helpers ──────────────────────────────────────────────────────
  function parseBoxes(bytes, start, end) {
    var boxes = [], o = start;
    while (o + 8 <= end) {
      var size = ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
      var type = latinstr(u8slice(bytes, o + 4, o + 8));
      var header = 8;
      if (size === 1 && o + 16 <= end) {
        size = (((bytes[o + 8] << 21) + (bytes[o + 9] << 14) + (bytes[o + 10] << 7) + bytes[o + 11]) << 10) + 0; // not expected; fall through
        size = Number((((bytes[o + 8] >>> 0) << 24) | (bytes[o + 9] << 16) | (bytes[o + 10] << 8) | bytes[o + 11]) >>> 0) * 4294967296 + (((bytes[o + 12] << 24) | (bytes[o + 13] << 16) | (bytes[o + 14] << 8) | bytes[o + 15]) >>> 0);
        header = 16;
      } else if (size === 0) { size = end - o; }
      if (size < header || o + size > end) break;
      boxes.push({ type: type, start: o, header: header, size: size, payloadStart: o + header, payloadEnd: o + size });
      o += size;
    }
    return boxes;
  }
  function box(type, payload) {
    var out = new Uint8Array(8 + payload.length);
    out.set(u32be(8 + payload.length), 0); out.set(latin(String(type).substring(0, 4)), 4); out.set(payload, 8);
    return out;
  }
  function ilstDataItem(value, kind) {
    var payload, typeCode = 1;
    if (kind === "jpeg") { typeCode = 0x0000000d; payload = value; }
    else if (kind === "png") { typeCode = 0x0000000e; payload = value; }
    else { payload = utf8(value); }
    return box("data", concat(new Uint8Array(u32be(typeCode)), new Uint8Array(u32be(0)), payload));
  }
  var COPY = "\u00a9";
  function buildIlst(m) {
    var items = [];
    if (m.title) items.push(box(COPY + "nam", ilstDataItem(m.title)));
    if (m.artist) items.push(box(COPY + "ART", ilstDataItem(m.artist)));
    if (m.album) items.push(box(COPY + "alb", ilstDataItem(m.album)));
    if (m.genre) items.push(box(COPY + "gen", ilstDataItem(m.genre)));
    if (m.picture && m.picture.data && m.picture.data.length) items.push(box("covr", ilstDataItem(m.picture.data, /png/i.test(m.picture.mime || "") ? "png" : "jpeg")));
    return box("ilst", concat.apply(null, items));
  }
  function buildMeta(m) {
    var ilst = buildIlst(m);
    var hdlr = box("hdlr", u8slice(concat(new Uint8Array(u32be(0)), new Uint8Array(u32be(0)), latin("mdir"), new Uint8Array(12), new Uint8Array([0]))));
    return box("meta", concat(new Uint8Array(u32be(0)), hdlr, ilst));
  }
  function buildUdta(m) { return box("udta", buildMeta(m)); }
  function rebuildWithTags(bytes, moov, m) {
    var inner = parseBoxes(bytes, moov.payloadStart, moov.payloadEnd);
    var udta = null, i;
    for (i = 0; i < inner.length; i++) if (inner[i].type === "udta") { udta = inner[i]; break; }
    var before = u8slice(bytes, 0, moov.start);
    var after = u8slice(bytes, moov.payloadEnd);
    var rawInner = [];
    for (i = 0; i < inner.length; i++) rawInner.push(u8slice(bytes, inner[i].start, inner[i].start + inner[i].size));
    var newInner;
    if (udta) {
      var udtaInner = parseBoxes(bytes, udta.payloadStart, udta.payloadEnd);
      var metaIdx = -1;
      for (i = 0; i < udtaInner.length; i++) if (udtaInner[i].type === "meta") { metaIdx = i; break; }
      var udtaRaw = [];
      for (i = 0; i < udtaInner.length; i++) udtaRaw.push(u8slice(bytes, udtaInner[i].start, udtaInner[i].start + udtaInner[i].size));
      var rebuiltUdta;
      if (metaIdx >= 0) rebuiltUdta = box("udta", concat.apply(null, udtaRaw.slice(0, metaIdx).concat([buildMeta(m)]).concat(udtaRaw.slice(metaIdx + 1))));
      else rebuiltUdta = box("udta", concat.apply(null, udtaRaw.concat([buildMeta(m)])));
      var udtaIdx = -1;
      for (i = 0; i < inner.length; i++) if (inner[i].type === "udta") { udtaIdx = i; break; }
      newInner = rawInner.slice(); newInner[udtaIdx] = rebuiltUdta;
    } else {
      newInner = rawInner.concat([buildUdta(m)]);
    }
    return concat(before, box("moov", concat.apply(null, newInner)), after);
  }
  function mp4IlstTag(audio, meta) {
    var top = parseBoxes(audio, 0, audio.length), moov = null, i;
    for (i = 0; i < top.length; i++) if (top[i].type === "moov") { moov = top[i]; break; }
    if (moov) return rebuildWithTags(audio, moov, meta);
    return concat(box("moov", buildUdta(meta)), audio);
  }

  function embed(u8, ext, meta) {
    var e = String(ext || "").toLowerCase();
    if (e === "mp3" || e === "mp2") return id3v2Tag(u8, meta);
    if (e === "m4a" || e === "aac" || e === "mp4" || e === "m4b") return mp4IlstTag(u8, meta);
    return u8; // webm/ogg/opus/flac: container preserved untagged
  }
  function read(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return readId3v2(bytes);
    var top = parseBoxes(bytes, 0, bytes.length), moov = null, i;
    for (i = 0; i < top.length; i++) if (top[i].type === "moov") { moov = top[i]; break; }
    if (!moov) return { container: "unknown", title: "", artist: "", album: "", genre: "", picture: null };
    var inner = parseBoxes(bytes, moov.payloadStart, moov.payloadEnd), udta = null;
    for (i = 0; i < inner.length; i++) if (inner[i].type === "udta") { udta = inner[i]; break; }
    var out = { container: "mp4", title: "", artist: "", album: "", genre: "", picture: null };
    if (!udta) return out;
    var udtai = parseBoxes(bytes, udta.payloadStart, udta.payloadEnd), meta = null;
    for (i = 0; i < udtai.length; i++) if (udtai[i].type === "meta") { meta = udtai[i]; break; }
    if (!meta) return out;
    var metai = parseBoxes(bytes, meta.payloadStart + 4, meta.payloadEnd), ilst = null;
    for (i = 0; i < metai.length; i++) if (metai[i].type === "ilst") { ilst = metai[i]; break; }
    if (!ilst) return out;
    var items = parseBoxes(bytes, ilst.payloadStart, ilst.payloadEnd);
    for (i = 0; i < items.length; i++) {
      var kids = parseBoxes(bytes, items[i].payloadStart, items[i].payloadEnd), dataBox = null, k;
      for (k = 0; k < kids.length; k++) if (kids[k].type === "data") { dataBox = kids[k]; break; }
      if (!dataBox) continue;
      var tCode = ((bytes[dataBox.payloadStart] << 24) | (bytes[dataBox.payloadStart + 1] << 16) | (bytes[dataBox.payloadStart + 2] << 8) | bytes[dataBox.payloadStart + 3]) >>> 0;
      var value = u8slice(bytes, dataBox.payloadStart + 8, dataBox.payloadEnd);
      if (items[i].type === COPY + "nam") out.title = utf8str(value);
      else if (items[i].type === COPY + "ART") out.artist = utf8str(value);
      else if (items[i].type === COPY + "alb") out.album = utf8str(value);
      else if (items[i].type === COPY + "gen") out.genre = utf8str(value);
      else if (items[i].type === "covr") out.picture = { mime: tCode === 0x0e ? "image/png" : "image/jpeg", data: value };
    }
    return out;
  }

  g.MuchiMeta = { embed: embed, read: read, id3v2Tag: id3v2Tag, mp4IlstTag: mp4IlstTag };
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
