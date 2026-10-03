import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import AdminUsers from "@/components/admin-users";
import { currentUser } from "@/lib/server/access";

/** Spec §24.6: admin only; everyone else gets a 404, so the page stays hidden. */
export default async function AdminPage() {
  await connection();
  const user = await currentUser(await headers());
  if (!user || user.role !== "admin") notFound();
  return (
    <main className="mx-auto flex h-dvh w-full max-w-3xl flex-col gap-4 px-4 pt-6 pb-4">
      <AdminUsers adminId={user.id} />
    </main>
  );
}
