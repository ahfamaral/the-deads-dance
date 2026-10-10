import { execFileSync } from "node:child_process";
import type { CodeVersion } from "./types";

/** The code that shapes an answer or its score; uncommitted changes here mean the commit alone won't reproduce a run. */
const CODE_PATHS = ["src", "corpus", "eval", "mcp-server", "personas.json", "package.json", "package-lock.json"];

export function parseCodeVersion(commit: string, status: string): CodeVersion {
  const uncommitted = status.split("\n").filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1)!);
  return { commit: commit.trim().slice(0, 7), uncommitted };
}

export function readCodeVersion(): CodeVersion {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
  return parseCodeVersion(git("rev-parse", "HEAD"), git("status", "--porcelain", "--untracked-files=all", "--", ...CODE_PATHS));
}

export function codeWarning(code: CodeVersion): string | null {
  if (!code.uncommitted.length) return null;
  return `Warning: uncommitted changes in ${code.uncommitted.join(", ")}. The run records them, but commit ${code.commit} alone won't reproduce it.`;
}

export function describeCode(code: CodeVersion[] | undefined): string {
  if (!code?.length) return "Code: commit not recorded.";
  const one = (c: CodeVersion) => `commit ${c.commit}${c.uncommitted.length ? `, with uncommitted changes in ${c.uncommitted.join(", ")}` : ""}`;
  return `Code: ${code.map(one).join("; ")}.`;
}
