import { languageName } from "@corpus/languages";
import { about, BODY, BTN, BTN_PRIMARY, CARD, ROW } from "@/components/admin-styles";
import { formatDollars } from "@/lib/money";
import type { ChangeLine } from "@/lib/persona-profile";

type Props = {
  changes: ChangeLine[];
  /** Micro-dollars: the changes plus the redraft when ticked. */
  total: number;
  /** The code of the language whose article passages go, or null. */
  articleLanguageRemoved: string | null;
  redraft: boolean;
  redraftEstimated: number;
  onToggleRedraft: () => void;
  onConfirm: () => void;
  onBack: () => void;
};

/** Spec §34.5 (mockup 2c): what the round changes, each priced, the removal note, the redraft tick box, then Reingest or Back. */
export default function ReingestConfirm({ changes, total, articleLanguageRemoved, redraft, redraftEstimated, onToggleRedraft, onConfirm, onBack }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <ul>
          {changes.map((c) => (
            <li key={c.label} className={`${ROW} ${BODY}`}>
              <span className="min-w-0 break-words">{c.label}</span>
              <span className="shrink-0 whitespace-nowrap tabular-nums">{c.estimated > 0 ? about(c.estimated) : "free"}</span>
            </li>
          ))}
          {redraft && (
            <li className={`${ROW} ${BODY}`}>
              <span className="min-w-0">Highlights and character redrafted</span>
              <span className="shrink-0 whitespace-nowrap tabular-nums">{about(redraftEstimated)}</span>
            </li>
          )}
        </ul>
        <div className="mt-2 flex justify-between gap-3 border-t border-white/15 pt-3 text-base font-semibold sm:text-sm">
          <span>Total</span>
          <span className="tabular-nums">{about(total)}</span>
        </div>
      </section>

      {articleLanguageRemoved && (
        <p className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-base text-neutral-100 sm:text-sm">
          {`${languageName(articleLanguageRemoved)} passages are removed. Past conversations keep their source chips. Testers keep the current memory until this finishes.`}
        </p>
      )}

      <label className={`${CARD} flex min-h-11 cursor-pointer items-start gap-3`}>
        <input type="checkbox" checked={redraft} onChange={onToggleRedraft} className="mt-1 size-5 shrink-0 accent-lime-400" />
        <span className={`${BODY} min-w-0 flex-1`}>Also redraft highlights and character from the new sources</span>
        <span className={`${BODY} shrink-0 whitespace-nowrap tabular-nums`}>{about(redraftEstimated)}</span>
      </label>

      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <button type="button" onClick={onConfirm} disabled={changes.length === 0 && !redraft} className={`${BTN_PRIMARY} w-full sm:w-auto`}>
          {`Reingest · ${formatDollars(total)}`}
        </button>
        <button type="button" onClick={onBack} className={`${BTN} w-full sm:w-auto`}>
          Back
        </button>
      </div>
    </div>
  );
}
