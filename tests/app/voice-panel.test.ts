import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AddPersonaForm from "@/components/add-persona-form";
import PersonaPicker from "@/components/persona-picker";
import { VoiceForm } from "@/components/voice-panel";
import type { Persona } from "@/lib/personas";
import { GEMINI_VOICES, type VoiceDto } from "@/lib/voice";

const noop = () => {};
const draft: VoiceDto = {
  baseVoice: "Kore",
  description: "A calm, low voice.",
  sampleText: "Hello.",
  status: "draft",
  hasSample: true,
  updatedAt: "2026-10-16T10:00:00.000Z",
  sampleLanguage: "pt",
  warning: null,
};
const form = (voice: VoiceDto, over: Partial<Parameters<typeof VoiceForm>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(VoiceForm, {
      slug: "wu",
      voice,
      baseVoice: voice.baseVoice,
      description: voice.description,
      busy: false,
      error: null,
      onBaseVoice: noop,
      onDescription: noop,
      onTryAgain: noop,
      onApprove: noop,
      onTurnOff: noop,
      ...over,
    }),
  );

describe("VoiceForm", () => {
  it("shows the controls for a draft", () => {
    const html = form(draft);
    expect(html.match(/<option/g)).toHaveLength(GEMINI_VOICES.length);
    expect(html).toContain("Kore · Firm · female");
    expect(html).toContain('maxLength="600"');
    expect(html).toContain('<audio controls=""');
    expect(html).toContain("/api/personas/wu/voice/sample?v=");
    expect(html).toContain("Sample (Portuguese)");
    for (const label of ["Try again", "Turn voice off", "Approve", "Status: Draft"]) expect(html).toContain(label);
  });

  it("shows the warning when there is one", () => {
    expect(form({ ...draft, warning: "The description names the persona." })).toContain("The description names the persona.");
  });

  it("disables Approve without a sample, with unsaved edits, or while busy", () => {
    const approveDisabled = (html: string) => /<button[^>]*disabled=""[^>]*>Approve</.test(html);
    expect(approveDisabled(form(draft))).toBe(false);
    expect(approveDisabled(form({ ...draft, hasSample: false }))).toBe(true);
    expect(approveDisabled(form(draft, { description: "Changed" }))).toBe(true);
    expect(approveDisabled(form(draft, { busy: true }))).toBe(true);
  });

  it("shows an API error as an alert", () => {
    expect(form(draft, { error: "The speech model failed." })).toMatch(/role="alert"[^>]*>The speech model failed\./);
  });
});

describe("add-persona report", () => {
  it("offers to create a voice", () => {
    const html = renderToStaticMarkup(
      createElement(AddPersonaForm, { onAdded: noop, onCancel: noop, onWorkingChange: noop, onCreateVoice: noop, initialPhase: {
        kind: "report",
        persona: { id: "wu", name: "Chien-Shiung Wu" } as Persona,
        report: { rows: [{ label: "x", tokens: 1, cost: 0, estimated: false }], total: { tokens: 1, cost: 0 } },
      } as never }),
    );
    expect(html).toContain("Create a voice for Chien-Shiung Wu?");
    expect(html).toContain("Create voice");
    expect(html).toContain("Not now");
    expect(html.indexOf("Not now")).toBeLessThan(html.indexOf("Done"));
  });
});

describe("PersonaPicker voice button", () => {
  it("renders a Voice button per persona in config mode markup", () => {
    const p = { id: "wu", name: "Chien-Shiung Wu", description: "", lifespan: "", origin: "curated", hidden: false, voiceLanguages: [], voiceStatus: null } as Persona;
    const html = renderToStaticMarkup(
      createElement(PersonaPicker, { personas: [p], canManage: true, notice: null, onConfirm: noop, onDelete: noop, onToggleHidden: noop, onEditVoice: noop, onAdd: noop, onBack: noop, meter: null, onDismissBanner: noop }),
    );
    expect(html).toContain('aria-label="Voice for Chien-Shiung Wu"');
  });
});
