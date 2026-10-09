/** Drops the lines of a prompt section that start with one of the prefixes (spec §30.3: no duplicate rules). */
export function withoutLines(section: string, prefixes: readonly string[]): string {
  return section.split("\n").filter((line) => !prefixes.some((p) => line.startsWith(p))).join("\n");
}
