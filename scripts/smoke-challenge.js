import fs from "node:fs";

const base = "http://127.0.0.1:8787";
const knownPath = "out/known_words.json";
const knownBefore = fs.existsSync(knownPath)
  ? fs.readFileSync(knownPath, "utf8")
  : "";

const start = await (
  await fetch(base + "/api/challenge/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level: "both" }),
  })
).json();

const steps = start.steps || [];
const knows = steps.filter((s) => s.type === "know");
const verifies = steps.filter((s) => s.type === "verify");
const blanks = verifies.filter((s) => s.mode === "blank");
const choices = verifies.filter((s) => s.mode === "choice");

console.log(
  "start",
  start.ok,
  start.artist,
  "phase",
  start.phase,
  "know",
  knows.length,
  "verify",
  verifies.length
);

// Interleaved: some know steps followed immediately by verify with after_id
let interleavedOk = true;
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  if (s.type !== "verify") continue;
  const prev = steps[i - 1];
  if (!prev || prev.type !== "know" || s.after_id !== prev.id) {
    interleavedOk = false;
    break;
  }
}
console.log(
  "interleaved",
  interleavedOk,
  "mix choice",
  choices.length,
  "blank",
  blanks.length,
  "two_lines",
  knows.every((s) => Array.isArray(s.lines) && s.lines.length >= 1)
);
console.log(
  "blank shows word + meaning prompt",
  blanks.every(
    (s) =>
      s.word &&
      Array.isArray(s.lines) &&
      !s.lines.some((l) => String(l).includes("____")) &&
      String(s.prompt || "").includes("中文")
  )
);

const answers = [];
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  if (s.type === "know") {
    // Claim known so following verify (if any) runs
    const ans = { id: s.id, known: true };
    answers.push(ans);
    await fetch(base + "/api/challenge/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge_id: start.challenge_id, answer: ans }),
    });
    continue;
  }
  if (s.mode === "blank") {
    const check = await (
      await fetch(base + "/api/challenge/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge_id: start.challenge_id,
          id: s.id,
          blank: "这是一个完全错误的中文意思xyz",
          answers_so_far: answers,
        }),
      })
    ).json();
    console.log(
      "blank",
      s.id,
      "word",
      s.word,
      "correct",
      check.correct,
      "busted",
      check.busted,
      "reveal",
      check.correct_answer
    );
    answers.push({
      id: s.id,
      blank: "这是一个完全错误的中文意思xyz",
      correct: check.correct,
    });
  } else {
    const check = await (
      await fetch(base + "/api/challenge/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge_id: start.challenge_id,
          id: s.id,
          choice: "__not_a_real_gloss__",
          answers_so_far: answers,
        }),
      })
    ).json();
    console.log(
      "choice",
      s.id,
      "after",
      s.after_id,
      "correct",
      check.correct,
      "busted",
      check.busted,
      "reveal",
      check.correct_answer
    );
    answers.push({
      id: s.id,
      choice: "__not_a_real_gloss__",
      correct: check.correct,
    });
  }
}

const finish = await (
  await fetch(base + "/api/challenge/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge_id: start.challenge_id, answers }),
  })
).json();
console.log(
  "finish",
  finish.ok,
  finish.tier?.label,
  `${finish.estimated_known}/${finish.total_words}`,
  "busted",
  finish.busted_count,
  "verify",
  `${finish.verify_correct}/${finish.verify_total}`
);

const knownAfter = fs.existsSync(knownPath)
  ? fs.readFileSync(knownPath, "utf8")
  : "";
console.log("known_words unchanged", knownBefore === knownAfter);

const html = await (await fetch(base + "/learn")).text();
console.log(
  "ui",
  html.includes("穿插抽查") || html.includes("当场抽查"),
  html.includes("challenge-bust-answer"),
  html.includes("不要欺骗自己哦"),
  html.includes("challenge-blank-wrap[hidden]")
);
