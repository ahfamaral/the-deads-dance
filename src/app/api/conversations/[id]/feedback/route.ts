import { z } from "zod";
import { getPool } from "@corpus/db";
import { modelId } from "@corpus/models";
import { FeedbackInputSchema } from "@/lib/feedback";
import { requireApproved, unavailable } from "@/lib/server/access";
import { saveFeedback } from "@/lib/server/feedback";

const gone = () =>
  Response.json({ error: "This conversation is no longer available.", code: "unknown_conversation" }, { status: 404 });
// A malformed id can't be anyone's conversation. Checked here, so Postgres' uuid cast never turns it into a 503.
const isId = (id: string) => z.uuid().safeParse(id).success;

/**
 * Spec §32.3: rate one of your own conversations, or change your rating. Only the owner rates,
 * the admin included. The first save records the agent model and the deployed commit.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/conversations/[id]/feedback">) {
  try {
    const user = await requireApproved(request);
    if (user instanceof Response) return user;
    const { id } = await ctx.params;
    if (!isId(id)) return gone();
    const parsed = FeedbackInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: "Pick 1 to 5 stars; the comment can be up to 200 characters.", code: "invalid_feedback" },
        { status: 400 },
      );
    }
    const result = await saveFeedback(getPool(), {
      conversationId: id,
      userId: user.id,
      ...parsed.data,
      model: modelId("agent"),
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "dev",
    });
    if (!result.ok) {
      return result.reason === "not_found"
        ? gone()
        : Response.json({ error: "There's nothing to rate yet.", code: "no_messages" }, { status: 400 });
    }
    return Response.json({ feedback: result.feedback });
  } catch (err) {
    return unavailable(err);
  }
}
