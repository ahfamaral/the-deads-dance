import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { describeDbError, getPool } from "@corpus/db";
import PersonaProfile from "@/components/persona-profile";
import { profileBanner, queryMicros } from "@/lib/persona-profile";
import { profileBackHref } from "@/lib/profile-links";
import { currentUser } from "@/lib/server/access";
import { loadPersonaProfile } from "@/lib/server/persona-admin";

/** Spec §34.4: a persona's profile; admin only, and a 404 for everyone else, as /admin. */
export default async function PersonaProfilePage({ params, searchParams }: PageProps<"/admin/personas/[slug]">) {
  await connection();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const main = (children: ReactNode) => <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-6 pb-10">{children}</main>;
  let user: Awaited<ReturnType<typeof currentUser>>;
  let dto: Awaited<ReturnType<typeof loadPersonaProfile>> = null;
  try {
    user = await currentUser(await headers());
    if (user?.role === "admin") dto = await loadPersonaProfile(getPool(), slug);
  } catch (err) {
    // Spec §24.9: the database is down. Say so instead of crashing the page.
    console.error(err);
    return main(
      <p role="alert" className="m-auto max-w-[280px] text-center text-base text-neutral-400 sm:text-sm">
        Service unavailable. {describeDbError(err) ?? "Try again in a minute."}
      </p>,
    );
  }
  if (!user || user.role !== "admin" || !dto) notFound();

  const banner = profileBanner(dto, query);
  const from = typeof query.from === "string" ? `from=${encodeURIComponent(query.from)}` : "";
  return main(<PersonaProfile slug={slug} initial={dto} backHref={profileBackHref(from)} banner={banner} offerVoice={queryMicros(query.added) !== null} />);
}
