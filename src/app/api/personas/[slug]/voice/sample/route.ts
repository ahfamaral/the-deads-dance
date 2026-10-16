import { requireAdmin, unavailable } from "@/lib/server/access";
import { findVoice } from "@/lib/server/persona-voices";
import { voiceDeps } from "@/lib/server/voice-deps";

/** Spec §33.3: the stored sample, for the admin's player. */
export async function GET(request: Request, ctx: RouteContext<"/api/personas/[slug]/voice/sample">) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    const { slug } = await ctx.params;
    const voice = await findVoice(voiceDeps().pool, slug);
    if (!voice?.sampleAudio) return Response.json({ error: "No sample yet." }, { status: 404 });
    const bytes = new Uint8Array(voice.sampleAudio);
    return new Response(bytes, {
      headers: { "Content-Type": "audio/wav", "Content-Length": String(bytes.byteLength), "Cache-Control": "no-store" },
    });
  } catch (err) {
    return unavailable(err);
  }
}
