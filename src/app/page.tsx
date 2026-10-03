import { headers } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { describeDbError } from "@corpus/db";
import ChatFlow from "@/components/chat-flow";
import SignIn from "@/components/sign-in";
import StatusScreen from "@/components/status-screen";
import { currentUser } from "@/lib/server/access";
import { loadPersonas } from "@/lib/server/load-personas";

export default async function Home() {
  // Personas and the session come from the database, so render per request.
  await connection();
  const main = (children: ReactNode) => (
    <main className="mx-auto flex h-dvh w-full max-w-3xl flex-col gap-4 px-4 pt-6 pb-4">{children}</main>
  );
  let user: Awaited<ReturnType<typeof currentUser>>;
  try {
    user = await currentUser(await headers());
  } catch (err) {
    // Spec §24.9: the database is down. Say so instead of crashing the page.
    console.error(err);
    return main(
      <p role="alert" className="m-auto max-w-[280px] text-center text-sm text-neutral-400">
        Service unavailable. {describeDbError(err) ?? "Try again in a minute."}
      </p>,
    );
  }
  // Spec §24.6. A blocked user has no session (block deletes them), so lands on sign-in.
  // The site key is read here, at request time, so a build made without it still works.
  if (!user) return main(<SignIn siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""} />);
  const isAdmin = user.role === "admin";
  if (!isAdmin && user.status === "pending") return main(<StatusScreen status="pending" email={user.email} />);
  if (!isAdmin && user.status !== "approved") return main(<StatusScreen status="rejected" email={user.email} />);
  const { personas, unavailable } = await loadPersonas();
  return main(<ChatFlow initialPersonas={personas} personasUnavailable={unavailable} email={user.email} isAdmin={isAdmin} />);
}
