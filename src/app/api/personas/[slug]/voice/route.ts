import { z } from "zod";
import { CostLedger } from "@corpus/cost-ledger";
import { findPersona, type PersonaRow } from "@corpus/personas";
import { requireAdmin, unavailable } from "@/lib/server/access";
import { approveVoice, deleteVoice, findVoice, insertVoice, setSample, updateVoice, type StoredVoice } from "@/lib/server/persona-voices";
import { recordCalls } from "@/lib/server/spend";
import { pcmToWav } from "@/lib/server/tts";
import { NAME_WARNING, sampleInstructions } from "@/lib/server/voice-draft";
import { voiceDeps, type VoiceDeps } from "@/lib/server/voice-deps";
import { GEMINI_VOICES, nameWordsIn, voiceLanguages, type VoiceDto } from "@/lib/voice";

const noPersona = () => Response.json({ error: "No such persona." }, { status: 404 });
const noVoice = () => Response.json({ error: "No voice yet." }, { status: 404 });
const sampleFailed = () => Response.json({ error: "Couldn't render the sample. Try again." }, { status: 502 });

/** `warning` is not stored: it is worked out again from the text each time. */
function toDto(persona: PersonaRow, v: StoredVoice, warning?: string | null): VoiceDto {
  const native = persona.languages.find((l) => l.native) ?? persona.languages[0];
  return {
    baseVoice: v.baseVoice,
    description: v.description,
    sampleText: v.sampleText,
    status: v.status,
    hasSample: v.sampleAudio !== null,
    updatedAt: v.updatedAt.toISOString(),
    sampleLanguage: native.code,
    warning: warning !== undefined ? warning : nameWordsIn(`${v.description} ${v.sampleText}`, persona.displayName).length > 0 ? NAME_WARNING : null,
  };
}

/** Records what the ledger holds, even when the request failed: the money was spent. Never throws. */
async function settle(deps: VoiceDeps, ledger: CostLedger, userId: string, slug: string) {
  try {
    const calls = await deps.resolveCosts(ledger.calls);
    await recordCalls(deps.pool, { userId, calls, charge: false, personaSlug: slug });
  } catch (err) {
    console.error(err);
  }
}

/** Spec §33.3: renders the saved form into a new sample. Returns false when the speech call failed. */
async function renderSample(deps: VoiceDeps, ledger: CostLedger, persona: PersonaRow, v: StoredVoice): Promise<boolean> {
  try {
    const { pcm, call } = await deps.speak({
      text: v.sampleText,
      voice: v.baseVoice,
      instructions: sampleInstructions(v, persona),
    });
    ledger.record(call);
    await setSample(deps.pool, persona.slug, pcmToWav(pcm));
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

const Edit = z
  .strictObject({
    baseVoice: z.enum(GEMINI_VOICES.map((v) => v.name) as [string, ...string[]]).optional(),
    description: z.string().trim().min(1).max(600).optional(),
    render: z.literal(true).optional(),
  })
  .refine((b) => b.baseVoice !== undefined || b.description !== undefined || b.render === true);
const Approve = z.strictObject({ status: z.literal("approved") });

/** Spec §33.3: the persona's voice (or null), and the languages a voice could serve. */
export async function GET(request: Request, ctx: RouteContext<"/api/personas/[slug]/voice">) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    const { slug } = await ctx.params;
    const deps = voiceDeps();
    const persona = await findPersona(deps.pool, slug);
    if (!persona) return noPersona();
    const voice = await findVoice(deps.pool, slug);
    return Response.json({ voice: voice && toDto(persona, voice), voiceLanguages: voiceLanguages(persona.languages) });
  } catch (err) {
    return unavailable(err);
  }
}

/** Spec §33.3: drafts the voice from the persona's traits and renders its first sample. */
export async function POST(request: Request, ctx: RouteContext<"/api/personas/[slug]/voice">) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    const { slug } = await ctx.params;
    const deps = voiceDeps();
    const persona = await findPersona(deps.pool, slug);
    if (!persona) return noPersona();
    if (voiceLanguages(persona.languages).length === 0) {
      return Response.json({ error: "No language this persona spoke can be voiced.", code: "no_voice_languages" }, { status: 400 });
    }
    if (await findVoice(deps.pool, slug)) return Response.json({ error: "This persona already has a voice." }, { status: 409 });

    const ledger = new CostLedger();
    try {
      let draft;
      try {
        draft = await deps.draftVoice(persona, [ledger.handler("helper")]);
      } catch (err) {
        console.error(err);
        return Response.json({ error: "Couldn't draft the voice. Try again." }, { status: 502 });
      }
      const { baseVoice, description, sampleText, warning } = draft;
      if (!(await insertVoice(deps.pool, { personaSlug: slug, baseVoice, description, sampleText }))) {
        return Response.json({ error: "This persona already has a voice." }, { status: 409 });
      }
      const stored = await findVoice(deps.pool, slug);
      if (!stored) return noVoice();
      if (!(await renderSample(deps, ledger, persona, stored))) return sampleFailed();
      const voice = (await findVoice(deps.pool, slug)) ?? stored;
      return Response.json({ voice: toDto(persona, voice, warning) }, { status: 201 });
    } finally {
      await settle(deps, ledger, admin.id, slug);
    }
  } catch (err) {
    return unavailable(err);
  }
}

/** Spec §33.3: edit the form (back to draft), render a new sample, or approve. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/personas/[slug]/voice">) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    const { slug } = await ctx.params;
    const raw = await request.json().catch(() => null);
    const approve = Approve.safeParse(raw);
    const edit = approve.success ? null : Edit.safeParse(raw);
    if (!approve.success && !edit?.success) {
      return Response.json({ error: "Expected { baseVoice?, description?, render? } or { status: \"approved\" }." }, { status: 400 });
    }
    const deps = voiceDeps();
    const persona = await findPersona(deps.pool, slug);
    if (!persona) return noPersona();
    if (!(await findVoice(deps.pool, slug))) return noVoice();

    if (approve.success) {
      if (!(await approveVoice(deps.pool, slug))) return Response.json({ error: "Render a sample before approving." }, { status: 409 });
    } else if (edit?.success) {
      const { baseVoice, description, render } = edit.data;
      if (baseVoice !== undefined || description !== undefined) {
        if (!(await updateVoice(deps.pool, slug, { baseVoice, description }))) return noVoice();
      }
      if (render) {
        const ledger = new CostLedger();
        try {
          const saved = await findVoice(deps.pool, slug);
          if (!saved) return noVoice();
          if (!(await renderSample(deps, ledger, persona, saved))) return sampleFailed();
        } finally {
          await settle(deps, ledger, admin.id, slug);
        }
      }
    }
    const voice = await findVoice(deps.pool, slug);
    if (!voice) return noVoice();
    return Response.json({ voice: toDto(persona, voice) });
  } catch (err) {
    return unavailable(err);
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/personas/[slug]/voice">) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    const { slug } = await ctx.params;
    const pool = voiceDeps().pool;
    if (!(await findPersona(pool, slug))) return noPersona();
    if (!(await deleteVoice(pool, slug))) return noVoice();
    return new Response(null, { status: 204 });
  } catch (err) {
    return unavailable(err);
  }
}
