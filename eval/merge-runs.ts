import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readBudget, TOTAL_LIMIT_MICROS } from "./budget";
import { renderReport } from "./report";
import type { RunResults } from "./types";

/** Spec §30.4: a round's two halves (or a redo) become one run, so one report gates and ranks them together. */
export function mergeResults(into: RunResults, from: RunResults, note: string): RunResults {
  if (into.baseline !== from.baseline) throw new Error(`These runs were compared with different baselines (${into.baseline}, ${from.baseline}).`);
  if (into.models.judge !== from.models.judge) throw new Error(`These runs were graded by different judges (${into.models.judge}, ${from.models.judge}).`);
  const key = (a: { setupId: string; questionId: string }) => `${a.setupId}\u0000${a.questionId}`;
  const replaced = new Set(from.answers.map(key));
  return {
    ...into,
    setups: [...new Set([...into.setups, ...from.setups])],
    questions: [...new Set([...into.questions, ...from.questions])],
    estimateMicros: into.estimateMicros + from.estimateMicros,
    actualMicros: into.actualMicros + from.actualMicros,
    stoppedReason: [into.stoppedReason, from.stoppedReason].filter(Boolean).join("; ") || null,
    notes: [...(into.notes ?? []), note],
    models: { judge: into.models.judge, agent: { ...into.models.agent, ...from.models.agent } },
    code: [...(into.code ?? []), ...(from.code ?? [])].filter((c, i, all) => all.findIndex((d) => JSON.stringify(d) === JSON.stringify(c)) === i),
    answers: [...into.answers.filter((a) => !replaced.has(key(a))), ...from.answers],
  };
}

/** Merging a run into itself would count its money and answers twice. */
export function checkMergeDirs(intoDir: string, fromDir: string): void {
  if (resolve(intoDir) === resolve(fromDir)) throw new Error("Can't merge a run into itself.");
}

function main(): void {
  const [intoDir, fromDir, note] = process.argv.slice(2);
  if (!intoDir || !fromDir || !note) throw new Error('Usage: npm run eval:merge -- <intoDir> <fromDir> "<note>"');
  checkMergeDirs(intoDir, fromDir);
  const read = (dir: string) => JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as RunResults;
  const merged = mergeResults(read(intoDir), read(fromDir), note);
  let n = 1;
  while (existsSync(join(intoDir, `results-before-merge-${n}.json`))) n++;
  writeFileSync(join(intoDir, `results-before-merge-${n}.json`), readFileSync(join(intoDir, "results.json")));
  writeFileSync(join(intoDir, "results.json"), `${JSON.stringify(merged, null, 2)}\n`);
  const spent = readBudget("eval/budget.json")?.spentMicros ?? 0;
  writeFileSync(join(intoDir, "report.md"), renderReport(merged, { leftMicros: TOTAL_LIMIT_MICROS - spent }));
  console.log(`Merged into ${intoDir}/report.md (backup: results-before-merge-${n}.json).`);
}

if (process.argv[1]?.endsWith("merge-runs.ts")) main();
