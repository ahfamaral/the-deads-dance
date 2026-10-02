import { connection } from "next/server";
import ChatFlow from "@/components/chat-flow";
import { loadPersonas } from "@/lib/server/load-personas";

export default async function Home() {
  // Personas come from the database, so render per request rather than at build time.
  await connection();
  const { personas, unavailable } = await loadPersonas();
  return (
    <main className="mx-auto flex h-dvh w-full max-w-3xl flex-col gap-4 px-4 pt-6 pb-4">
      <ChatFlow initialPersonas={personas} personasUnavailable={unavailable} />
    </main>
  );
}
