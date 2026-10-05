import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { describeDbError } from "@corpus/db";
import AdminUsers from "@/components/admin-users";
import { currentUser } from "@/lib/server/access";

/** Spec §24.6: admin only; everyone else gets a 404, so the page stays hidden. */
export default async function AdminPage() {
  await connection();
  const main = (children: ReactNode) => (
    <main className="mx-auto flex h-dvh w-full max-w-3xl flex-col gap-4 px-4 pt-6 pb-4">{children}</main>
  );
  let user: Awaited<ReturnType<typeof currentUser>>;
  try {
    user = await currentUser(await headers());
  } catch (err) {
    // Spec §24.9: the database is down. Say so instead of crashing the page, as on the home page.
    console.error(err);
    return main(
      <p role="alert" className="m-auto max-w-[280px] text-center text-sm text-neutral-400">
        Service unavailable. {describeDbError(err) ?? "Try again in a minute."}
      </p>,
    );
  }
  if (!user || user.role !== "admin") notFound();
  return main(<AdminUsers adminId={user.id} />);
}
