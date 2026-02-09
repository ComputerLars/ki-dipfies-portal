import fs from "fs";
import path from "path";
import mammoth from "mammoth";

const DOCX_SOURCES = [
  { id: "core", name: "CORE TRANSCRIPT", file: "source/drama_versions/Long KI-DIPFIES Gipfeltreffen – Stenographic Transcripts (1).docx", era: "2026" },
  { id: "mirror", name: "MIRROR TRANSCRIPT", file: "source/drama_versions/KI-DIPFIES Mega-Drama – Unified Composite Transcript.docx", era: "2026" },
  { id: "kopi", name: "KOPI VARIANT", file: "source/drama_versions/KI-DIPFIES_Kopi_minimally_fixed.docx", era: "2026" },
];
const DOCX_SOURCES_DE = [
  { id: "core", name: "KERNPROTOKOLL", file: "source/de/drama_versions/Long KI-DIPFIES Gipfeltreffen – Stenographic Transcripts.de.docx", era: "2026" },
  { id: "mirror", name: "SPIEGELPROTOKOLL", file: "source/de/drama_versions/KI-DIPFIES Mega-Drama – Unified Composite Transcript.de.docx", era: "2026" },
  { id: "kopi", name: "KOPI VARIANTE", file: "source/de/drama_versions/KI-DIPFIES_Kopi_minimally_fixed.de.docx", era: "2026" },
];
const FUTURE_SOURCES = [
  { id: "future-2027", name: "FUTURE 2027", file: "source/futures/Gipfeltreffen 2027.docx", era: "2027" },
  { id: "future-2027-mv", name: "FUTURE 2027 // MULTIVERSE", file: "source/futures/Gipfeltreffen 2027 - Multiverse.docx", era: "2027" },
  { id: "future-2050", name: "FUTURE 2050", file: "source/futures/Gipfeltreffen 2050.docx", era: "2050" },
  { id: "future-2050-mv", name: "FUTURE 2050 // MULTIVERSE", file: "source/futures/Gipfeltreffen 2050 - Multiverse.docx", era: "2050" },
];
const PAST_SOURCES = [
  { id: "past-1955", name: "PAST 1955", file: "source/pasts/KI-DIPFIES Gipfeltreffen 1955.docx", era: "1955" },
  { id: "past-1970", name: "PAST 1970", file: "source/pasts/KI-DIPFEL Gipfeltreffen – Memphis, 2–6 March 1970 (Summit Transcript).docx", era: "1970" },
];
const FUTURE_SOURCES_DE = [
  { id: "future-2027", name: "ZUKUNFT 2027", file: "source/de/futures/Gipfeltreffen 2027.de.docx", era: "2027" },
  { id: "future-2027-mv", name: "ZUKUNFT 2027 // MULTIVERSUM", file: "source/de/futures/Gipfeltreffen 2027 - Multiverse.de.docx", era: "2027" },
  { id: "future-2050", name: "ZUKUNFT 2050", file: "source/de/futures/Gipfeltreffen 2050.de.docx", era: "2050" },
  { id: "future-2050-mv", name: "ZUKUNFT 2050 // MULTIVERSUM", file: "source/de/futures/Gipfeltreffen 2050 - Multiverse.de.docx", era: "2050" },
];
const PAST_SOURCES_DE = [
  { id: "past-1955", name: "VERGANGENHEIT 1955", file: "source/de/pasts/KI-DIPFIES Gipfeltreffen 1955.de.docx", era: "1955" },
  { id: "past-1970", name: "VERGANGENHEIT 1970", file: "source/de/pasts/KI-DIPFEL Gipfeltreffen – Memphis, 2–6 March 1970 (Summit Transcript).de.docx", era: "1970" },
];
const THEORY_SOURCES = [
  { id: "theory-tragedy", name: "THEORY TRAGEDY", file: "source/theory/Theory Tragedy - Readers Version.docx", era: "2025", mode: "act" },
];
const ORIGIN_SOURCES = [
  { id: "origin-aleph", name: "GIPFESIS / א", file: "source/origin/GIPFESIS I.docx", era: "א" },
];
const THEORY_SOURCES_DE = [
  { id: "theory-tragedy", name: "THEORIE TRAGÖDIE", file: "source/theory/Theory Tragedy - Readers Version.de.docx", era: "2025", mode: "act" },
];
const ORIGIN_SOURCES_DE = [
  { id: "origin-aleph", name: "GIPFESIS / א", file: "source/de/origin/GIPFESIS I.de.docx", era: "א" },
];
const SAGER_SOURCES = [
  { name: "SAGER", file: "source/sager/syntetische_sager.docx", out: "data/sager.txt" },
];

const stripImages = (html) => html
  .replace(/<img[^>]*>/gi, "")
  .replace(/<svg[\s\S]*?<\/svg>/gi, "")
  .replace(/<picture[\s\S]*?<\/picture>/gi, "")
  .replace(/<object[\s\S]*?<\/object>/gi, "")
  .replace(/<embed[^>]*>/gi, "");

const stripTags = (html) => html
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"")
  .replace(/&#8220;|&#8221;|&#34;/g, "\"")
  .replace(/&#8216;|&#8217;|&#39;/g, "'")
  .trim();
const TRANSLATOR_NOISE = [
  /onlinedoctranslator/i,
  /www\.onlinedoctranslator\.com/i,
  /übersetzt von englisch/i,
  /translated from english/i,
  /translated by/i,
];
const isTranslatorNoise = (text) => {
  if(!text) return false;
  return TRANSLATOR_NOISE.some(re => re.test(text));
};
const normalizeUnicodeQuotes = (s) => s
  .replace(/[“”„‟]/g, "\"")
  .replace(/[‘’‚‛]/g, "'")
  .replace(/[：]/g, ":");
const normalizeSpeakerSpacing = (s) =>
  s.replace(/^([^\d:\n][^:\n]{1,70}:)(?=\S)/, (full, label) => {
    if(!/[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß]/.test(label)) return full;
    return `${label} `;
  });
const canonicalizePlainLine = (line) => {
  let out = (line || "").replace(/\u00a0/g, " ");
  out = normalizeUnicodeQuotes(out);
  out = out.replace(/[ \t]+/g, " ").trim();
  out = normalizeSpeakerSpacing(out);
  return out;
};
const splitHtmlAtPlainIndex = (html, idx) => {
  const s = String(html || "");
  let plainCount = 0;
  let i = 0;
  while(i < s.length){
    const ch = s[i];
    if(ch === "<"){
      const close = s.indexOf(">", i);
      if(close === -1) break;
      i = close + 1;
      continue;
    }
    if(ch === "&"){
      const semi = s.indexOf(";", i);
      if(semi !== -1){
        plainCount += 1;
        i = semi + 1;
        if(plainCount >= idx) break;
        continue;
      }
    }
    plainCount += 1;
    i += 1;
    if(plainCount >= idx) break;
  }
  return [s.slice(0, i), s.slice(i)];
};
const ensureSpeakerGapInBlock = (html) => {
  const plain = stripTags(html || "");
  const m = plain.match(/^([^\d:\n][^:\n]{1,70}):(\S[\s\S]*)$/);
  if(!m) return html;
  if(!/[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß]/.test(m[1])) return html;
  const idx = m[1].length + 1;
  let [head, tail] = splitHtmlAtPlainIndex(html, idx);
  if(!tail) return html;
  const trailingClosers = tail.match(/^((?:<\/(?:strong|b|em|i|u|span)>\s*)+)/i);
  if(trailingClosers){
    head += trailingClosers[1];
    tail = tail.slice(trailingClosers[1].length);
  }
  if(!tail || /^(?:\s|&nbsp;)/i.test(tail)) return `${head}${tail}`;
  return `${head} ${tail}`;
};
const canonicalizeBlock = (html) => {
  let out = (html || "").replace(/\u00a0/g, " ");
  out = normalizeUnicodeQuotes(out);
  out = out.replace(/(<\/(?:strong|b|span)>)(?=[^\s<])/gi, "$1 ");
  out = out.replace(/(^|>|<br\s*\/?>|\n)(\s*[^\d:<\n][^:<\n]{1,70}:)(?=[^\s<])/gi, "$1$2 ");
  out = ensureSpeakerGapInBlock(out);
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.trim();
  return out;
};

function extractBlocks(html){
  if(!html) return [];
  const normalized = stripImages(html).replace(/\r/g, "").trim();
  if(!normalized) return [];
  const blocks = [];
  const rx = /<(p|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while((m = rx.exec(normalized))){
    const inner = canonicalizeBlock((m[2] || "").trim());
    if(inner) blocks.push(inner);
  }
  if(blocks.length){
    const cleaned = blocks.filter((b) => {
      const plain = stripTags(b);
      if(!plain) return false;
      return !isTranslatorNoise(plain);
    });
    if(cleaned.length) return cleaned;
    return blocks;
  }
  return isTranslatorNoise(stripTags(normalized)) ? [] : [normalized];
}

async function docxToBlocks(file){
  const result = await mammoth.convertToHtml({ path: file }, { styleMap: ["u => u"] });
  const html = result.value || "";
  return extractBlocks(html);
}
async function docxToLines(file){
  const blocks = await docxToBlocks(file);
  const lines = [];
  for(const block of blocks){
    const plain = stripTags(block);
    if(!plain) continue;
    plain.split(/\r?\n/).forEach(line => {
      const cleaned = canonicalizePlainLine(line);
      if(cleaned && !isTranslatorNoise(cleaned)) lines.push(cleaned);
    });
  }
  return lines;
}

const romanToInt = (s) => {
  if(/^[0-9]+$/.test(s)) return parseInt(s, 10);
  const roman = { I:1,V:5,X:10,L:50,C:100 };
  let total = 0, prev = 0;
  for(const ch of s.toUpperCase().split("").reverse()){
    const val = roman[ch] || 0;
    total += val < prev ? -val : val;
    prev = val;
  }
  return total || 1;
};

const DAY_WORDS = new Map([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ["first", 1], ["second", 2], ["third", 3], ["fourth", 4], ["fifth", 5],
  ["sixth", 6], ["seventh", 7], ["eighth", 8], ["ninth", 9], ["tenth", 10],
  ["eins", 1], ["zwei", 2], ["drei", 3], ["vier", 4], ["funf", 5],
  ["sechs", 6], ["sieben", 7], ["acht", 8], ["neun", 9], ["zehn", 10],
  ["erster", 1], ["erste", 1], ["zweiter", 2], ["zweite", 2], ["dritter", 3], ["dritte", 3],
  ["vierter", 4], ["vierte", 4], ["funfter", 5], ["funfte", 5], ["sechster", 6], ["sechste", 6],
  ["siebter", 7], ["siebte", 7], ["achter", 8], ["achte", 8], ["neunter", 9], ["neunte", 9],
  ["zehnter", 10], ["zehnte", 10],
]);
const normalizeDayWord = (s) => (s || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[.]/g, "")
  .trim();
const dayTokenToInt = (token) => {
  if(!token) return null;
  const cleaned = normalizeDayWord(token);
  if(!cleaned) return null;
  if(/^[0-9]+$/.test(cleaned)) return parseInt(cleaned, 10);
  if(/^[ivxlcdm]+$/i.test(cleaned)) return romanToInt(cleaned);
  return DAY_WORDS.get(cleaned) || null;
};

function splitDays(blocks){
  const days = new Map();
  let current = null;
  for(const block of blocks){
    const plain = stripTags(block);
    const patterns = [
      /^\s*[-–—]*\s*(?:Day|Tag)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9]+)\b/i,
      /^\s*[-–—]*\s*([A-Za-zÀ-ÖØ-öø-ÿ]+)\s+Tag\b/i,
    ];
    for(const re of patterns){
      const m = plain.match(re);
      if(!m) continue;
      const n = dayTokenToInt(m[1]);
      if(!n) continue;
      current = n;
      if(!days.has(current)) days.set(current, []);
      break;
    }
    if(current == null){
      current = 1;
      if(!days.has(current)) days.set(current, []);
    }
    days.get(current).push(block);
  }
  return Array.from(days.entries())
    .sort((a,b)=>a[0]-b[0])
    .map(([day, blocks]) => ({ day, blocks }));
}

function splitActs(blocks){
  const days = new Map();
  let current = null;
  const actRe = /^\s*[-–—]*\s*Act\s+([IVXLC0-9]+)\b/i;
  for(const block of blocks){
    const plain = stripTags(block);
    const m = plain.match(actRe);
    if(m){
      current = romanToInt(m[1]);
      if(!days.has(current)) days.set(current, []);
    }
    if(current == null){
      current = 1;
      if(!days.has(current)) days.set(current, []);
    }
    days.get(current).push(block);
  }
  return Array.from(days.entries())
    .sort((a,b)=>a[0]-b[0])
    .map(([day, blocks]) => ({ day, blocks }));
}

const leadingEnvelope = (html) => {
  let rest = (html || "").trim();
  const tags = [];
  for(let i=0;i<4;i++){
    const open = rest.match(/^<(strong|b|em|i|u)\b[^>]*>/i);
    if(!open) break;
    const tag = open[1].toLowerCase();
    const closeRe = new RegExp(`</${tag}>\\s*$`, "i");
    if(!closeRe.test(rest)) break;
    rest = rest.replace(new RegExp(`^<${tag}\\b[^>]*>`, "i"), "").replace(closeRe, "").trim();
    tags.push(tag);
  }
  return tags;
};
const wrapWithEnvelope = (html, envelope) => {
  let out = (html || "").trim();
  for(let i = envelope.length - 1; i >= 0; i--){
    const tag = envelope[i];
    out = `<${tag}>${out}</${tag}>`;
  }
  return out;
};
function harmonizeStyles(referenceWorlds, targetWorlds){
  const refMap = new Map(referenceWorlds.map(w => [w.id, w]));
  for(const tw of targetWorlds){
    const rw = refMap.get(tw.id);
    if(!rw) continue;
    const targetDays = tw.days || [];
    const refDays = rw.days || [];
    for(let di = 0; di < targetDays.length && di < refDays.length; di++){
      const tDay = targetDays[di];
      const rDay = refDays[di];
      if(!tDay || !rDay || tDay.day !== rDay.day) continue;
      const tBlocks = tDay.blocks || [];
      const rBlocks = rDay.blocks || [];
      for(let bi = 0; bi < tBlocks.length && bi < rBlocks.length; bi++){
        const tb = tBlocks[bi];
        const rb = rBlocks[bi];
        if(!tb || !rb) continue;
        const envelope = leadingEnvelope(rb);
        if(!envelope.length) continue;
        const current = leadingEnvelope(tb);
        if(current.length && current.join("|") === envelope.join("|")) continue;
        let inner = (tb || "").trim();
        for(const tag of current){
          inner = inner
            .replace(new RegExp(`^<${tag}\\b[^>]*>`, "i"), "")
            .replace(new RegExp(`</${tag}>\\s*$`, "i"), "")
            .trim();
        }
        tBlocks[bi] = wrapWithEnvelope(inner || tb, envelope);
      }
    }
  }
}
function alignDaySplits(referenceWorlds, targetWorlds){
  const refMap = new Map(referenceWorlds.map(w => [w.id, w]));
  for(const tw of targetWorlds){
    const rw = refMap.get(tw.id);
    if(!rw) continue;
    const rDays = rw.days || [];
    const tDays = tw.days || [];
    if(rDays.length <= 1) continue;
    if(tDays.length !== 1) continue;
    const flat = (tDays[0]?.blocks || []).slice();
    if(!flat.length) continue;
    const refCounts = rDays.map(d => (d.blocks || []).length);
    const refTotal = refCounts.reduce((sum, n) => sum + n, 0);
    if(refTotal <= 0) continue;
    const out = [];
    let cursor = 0;
    const total = flat.length;
    for(let i = 0; i < refCounts.length; i++){
      const remainingDays = refCounts.length - i - 1;
      const remaining = total - cursor;
      const ideal = Math.round((refCounts[i] / refTotal) * total);
      let take = (i === refCounts.length - 1) ? remaining : Math.max(1, ideal);
      const maxTake = remaining - remainingDays;
      take = Math.max(1, Math.min(maxTake, take));
      const dayNo = Number(rDays[i]?.day) || (i + 1);
      out.push({ day: dayNo, blocks: flat.slice(cursor, cursor + take) });
      cursor += take;
    }
    if(cursor < total && out.length){
      out[out.length - 1].blocks.push(...flat.slice(cursor));
    }
    tw.days = out;
    tw.stats = {
      days: out.length,
      blocks: total,
    };
  }
}

async function buildWorlds(sources){
  const worlds = [];
  for(const src of sources){
    const filePath = path.resolve(src.file);
    if(!fs.existsSync(filePath)){
      console.warn("Missing:", filePath);
      continue;
    }
    const blocks = await docxToBlocks(filePath);
    const days = (src.mode === "act") ? splitActs(blocks) : splitDays(blocks);
    const count = days.reduce((sum, d) => sum + d.blocks.length, 0);
    worlds.push({ id: src.id, name: src.name, era: src.era, days, stats: { days: days.length, blocks: count } });
  }
  return worlds;
}

async function main(){
  const writeDipfiesManifest = () => {
    const dir = path.resolve("assets/dipfies");
    if(!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".png")).sort();
    const manifest = { files: files.map(f => `assets/dipfies/${f}`) };
    fs.writeFileSync("data/dipfies.json", JSON.stringify(manifest, null, 2));
  };
  const worlds = await buildWorlds([...DOCX_SOURCES, ...PAST_SOURCES, ...FUTURE_SOURCES, ...THEORY_SOURCES, ...ORIGIN_SOURCES]);
  const worldsDe = await buildWorlds([...DOCX_SOURCES_DE, ...PAST_SOURCES_DE, ...FUTURE_SOURCES_DE, ...THEORY_SOURCES_DE, ...ORIGIN_SOURCES_DE]);
  alignDaySplits(worlds, worldsDe);
  harmonizeStyles(worlds, worldsDe);
  for(const sager of SAGER_SOURCES){
    const filePath = path.resolve(sager.file);
    if(!fs.existsSync(filePath)){
      console.warn("Missing:", filePath);
      continue;
    }
    const lines = await docxToLines(filePath);
    const outPath = path.resolve(sager.out);
    fs.writeFileSync(outPath, lines.join("\n"));
  }

  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const out = {
    version: stamp,
    canonical: "core",
    worlds,
  };

  fs.writeFileSync("data/drama_worlds.json", JSON.stringify(out, null, 2));
  if(worldsDe.length){
    const outDe = {
      version: stamp,
      canonical: "core",
      worlds: worldsDe,
    };
    fs.writeFileSync("data/drama_worlds.de.json", JSON.stringify(outDe, null, 2));
  }
  fs.writeFileSync("data/build.json", JSON.stringify({ build: stamp }, null, 2));
  writeDipfiesManifest();
  const indexPath = path.resolve("index.html");
  if(fs.existsSync(indexPath)){
    const html = fs.readFileSync(indexPath, "utf8");
    const updated = html
      .replace(/portal\.css\?v=[^"']+/g, `portal.css?v=${stamp}`)
      .replace(/portal\.js\?v=[^"']+/g, `portal.js?v=${stamp}`);
    if(updated !== html) fs.writeFileSync(indexPath, updated);
  }
  console.log("wrote", worlds.length, "worlds");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
