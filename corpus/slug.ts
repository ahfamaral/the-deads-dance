// Letters NFKD leaves intact but that have an obvious ASCII form.
const EXTRA: Record<string, string> = { ł: "l", Ł: "l", ø: "o", Ø: "o", đ: "d", Đ: "d", ß: "ss", æ: "ae", œ: "oe" };

/** "Marie Skłodowska-Curie" → "marie-sklodowska-curie". `fallback` when nothing Latin remains. */
export function slugify(title: string, fallback: string): string {
  const slug = title
    .replace(/[łŁøØđĐßæœ]/g, (ch) => EXTRA[ch])
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback.toLowerCase();
}
