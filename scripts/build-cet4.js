/**
 * Build cet4_words.txt + cet4_glossary.json (+ merged cet46_glossary.json)
 * from KyleBing "3四级-乱序.txt" style source (word\\tgloss).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "..", "data");

/** Function / ultra-high-freq words — not useful lyric "生词" targets. */
const STOP = new Set(
  `
a an the and or but if so nor yet
i me my mine myself we us our ours ourselves
you your yours yourself yourselves
he him his himself she her hers herself
it its itself they them their theirs themselves
this that these those
am is are was were be been being
do does did doing done
have has had having
will would shall should can could may might must
of to in on at for with from by as into onto upon
about above across after against along among around before behind below beneath beside between beyond during except inside near off outside over through throughout under until up within without
not no nor none never
what which who whom whose where when why how
all each every both few more most other another such
any some many much
than then there here thus
yes ok
`
    .trim()
    .split(/\s+/)
    .filter(Boolean)
);

function findSource() {
  const preferred = [
    path.join(DATA, "3四级.txt"),
    path.join(DATA, "3 四级-乱序.txt"),
  ];
  for (const p of preferred) {
    if (fs.existsSync(p)) return p;
  }
  const hit = fs.readdirSync(DATA).find((f) => /四级/.test(f) && f.endsWith(".txt"));
  if (hit) return path.join(DATA, hit);
  throw new Error("CET-4 source txt not found in data/");
}

const src = findSource();
const text = fs.readFileSync(src, "utf8");
const words = [];
const glossary = {};

for (const line of text.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const tab = line.indexOf("\t");
  const raw = (tab >= 0 ? line.slice(0, tab) : line).trim().toLowerCase();
  const gloss = (tab >= 0 ? line.slice(tab + 1) : "").trim();
  if (!/^[a-z][a-z\-']*$/.test(raw)) continue;
  if (STOP.has(raw)) continue;
  words.push(raw);
  if (gloss && !glossary[raw]) glossary[raw] = gloss;
}

const uniq = [...new Set(words)].sort();
fs.writeFileSync(path.join(DATA, "cet4_words.txt"), uniq.join("\n") + "\n", "utf8");
fs.writeFileSync(
  path.join(DATA, "cet4_glossary.json"),
  JSON.stringify(glossary, null, 2) + "\n",
  "utf8"
);

const cet6 = new Set(
  fs
    .readFileSync(path.join(DATA, "cet6_words.txt"), "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
const cet6g = JSON.parse(fs.readFileSync(path.join(DATA, "cet6_glossary.json"), "utf8"));
const only4 = uniq.filter((w) => !cet6.has(w));
const merged = new Set([...cet6, ...uniq]);
/** Prefer cet6 gloss when both exist (often richer), fill gaps from cet4. */
const mergedGloss = { ...glossary, ...cet6g };
fs.writeFileSync(
  path.join(DATA, "cet46_glossary.json"),
  JSON.stringify(mergedGloss, null, 2) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      source: path.basename(src),
      cet4: uniq.length,
      cet4_gloss: Object.keys(glossary).length,
      only_cet4_new: only4.length,
      cet6: cet6.size,
      combined: merged.size,
      merged_gloss: Object.keys(mergedGloss).length,
      samples: ["love", "heart", "dream", "accept", "ability", "bound", "happy", "music"].map(
        (w) => ({ w, cet4: uniq.includes(w), cet6: cet6.has(w) })
      ),
    },
    null,
    2
  )
);
