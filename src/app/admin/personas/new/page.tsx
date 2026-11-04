import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { describeDbError } from "@corpus/db";
import AddPersonaFlow from "@/components/add-persona-flow";
import { currentUser } from "@/lib/server/access";

/**
 * Spec §34.8: adding a persona, on its own page. Admin only, and a 404 for everyone else, as
 * /admin. `?title=` keeps the name across a refresh (spec §34.7).
 */
export default async function AddPersonaPage({ searchParams }: PageProps<"/admin/personas/new">) {
  await connection();
  const query = await searchParams;
  const main = (children: ReactNode) => <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-6 pb-10">{children}</main>;
  let user: Awaited<ReturnType<typeof currentUser>>;
  try {
    user = await currentUser(await headers());
  } catch (err) {
    // Spec §24.9: the database is down. Say so instead of crashing the page.
    console.error(err);
    return main(
      <p role="alert" className="m-auto max-w-[280px] text-center text-base text-neutral-400 sm:text-sm">
        Service unavailable. {describeDbError(err) ?? "Try again in a minute."}
      </p>,
    );
  }
  if (!user || user.role !== "admin") notFound();
  const title = typeof query.title === "string" ? query.title.slice(0, 200) : "";
  return main(<AddPersonaFlow initialTitle={title} />);
}
