import { listEditions } from "@corpus/editions";
import { FindBody, type FindResult } from "@/lib/persona-profile";
import { requireAdmin, unavailable } from "@/lib/server/access";
import { adminDeps, adminError, comparisonEstimateFor, newPersonaLanguages, resolveTarget } from "@/lib/server/persona-admin";

/**
 * Spec §34.3: the free lookup of a new persona: today's add checks (a dead person, not yet
 * listed), then the Wikipedia editions to compare and what comparing them would cost.
 */
export async function POST(request: Request) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin(request);
  } catch (err) {
    return unavailable(err);
  }
  if (admin instanceof Response) return admin;

  const body = FindBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Enter a Wikipedia title.", code: "invalid_title" }, { status: 400 });

  try {
    const deps = adminDeps();
    const target = await resolveTarget(body.data, deps);
    if (target?.kind !== "new") throw new Error("A title always resolves to a new persona.");
    const languages = await newPersonaLanguages(target.qid, deps);
    const editions = await listEditions(deps.client, target.qid, languages.map((l) => l.code));
    const result: FindResult = {
      slug: target.slug,
      name: target.entry.displayName ?? target.article.title,
      description: target.entry.description ?? "",
      lifespan: target.entry.lifespan ?? "",
      languages,
      editions: editions.map(({ language, title, words, badge }) => ({ language, title, words, badge })),
      compareEstimated: await comparisonEstimateFor(deps, editions.map((e) => e.chars)),
    };
    return Response.json(result);
  } catch (err) {
    return adminError(err);
  }
}
