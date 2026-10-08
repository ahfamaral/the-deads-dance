/**
 * A persona's death year, read from its lifespan. Shared by the persona prompt (src/) and the
 * MCP server's recall check, which can't import from src/.
 */

/** "1912–1997", "c. 1864–1943", "died 1932", "470 BC–399 BC" → the end year; "born 1950" (death date unknown) → null (spec §17.2). */
export function deathYear(lifespan: string): string | null {
  const match = lifespan.trim().match(/(?:[–-]|\bdied\s+)\s*(?:c\.\s*)?(\d{1,4}(?:\s*BC)?)$/);
  return match ? match[1] : null;
}

/** deathYear as a number, so years compare: "1981" → 1981, "399 BC" → -399 (spec §19.2). */
export function deathYearNumber(lifespan: string): number | null {
  const year = deathYear(lifespan);
  if (year === null) return null;
  const n = Number.parseInt(year, 10);
  return /BC$/.test(year) ? -n : n;
}

/** "1912–1997" → 1912, "c. 1864–1943" → 1864 (approximate), "born 1950" → 1950; "died 1932" → null (spec §28.3). */
export function birthYear(lifespan: string): { year: string; approximate: boolean } | null {
  const match = lifespan.trim().match(/^(?:born\s+)?(c\.\s*)?(\d{1,4}(?:\s*BC)?)(?=\s*(?:[–-]|$))/);
  return match ? { year: match[2], approximate: match[1] !== undefined } : null;
}
