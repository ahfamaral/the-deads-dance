import { z } from "zod";
import { getPool } from "@corpus/db";
import { requireApproved, unavailable } from "@/lib/server/access";
import { deleteConversation, readConversation } from "@/lib/server/conversations";

const gone = () =>
  Response.json({ error: "This conversation is no longer available.", code: "unknown_conversation" }, { status: 404 });
// A malformed id can't be anyone's conversation. Checked here, so Postgres' uuid cast never turns it into a 503.
const isId = (id: string) => z.uuid().safeParse(id).success;

/** Spec §25.4: one of your conversations, with its messages. Anyone else's is a 404. */
export async function GET(request: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  try {
    const user = await requireApproved(request);
    if (user instanceof Response) return user;
    const { id } = await ctx.params;
    if (!isId(id)) return gone();
    const conversation = await readConversation(getPool(), user.id, id);
    return conversation ? Response.json({ conversation }) : gone();
  } catch (err) {
    return unavailable(err);
  }
}

/** Spec §25.4: a hard delete; its messages go with it. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  try {
    const user = await requireApproved(request);
    if (user instanceof Response) return user;
    const { id } = await ctx.params;
    if (!isId(id)) return gone();
    return (await deleteConversation(getPool(), user.id, id)) ? new Response(null, { status: 204 }) : gone();
  } catch (err) {
    return unavailable(err);
  }
}
