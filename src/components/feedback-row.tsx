import { starsText, type Feedback } from "@/lib/feedback";

type FeedbackRowProps = {
  feedback: Feedback | null;
  /** The viewer owns the conversation; the admin reading someone else's can't rate it. */
  editable: boolean;
  onRate: () => void;
};

const SURFACE = "flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 rounded-3xl border border-white/10 bg-neutral-900/80 px-5 py-2 text-sm text-neutral-300 shadow-lg shadow-black/40 pointer-coarse:bg-neutral-900/90 pointer-fine:backdrop-blur-md";
const LINK = "inline-flex min-h-11 items-center whitespace-nowrap px-1 text-neutral-200 underline underline-offset-2 hover:text-foreground";

function Stars({ stars }: { stars: number }) {
  return (
    <>
      <span className="sr-only">{stars} of 5 stars</span>
      <span aria-hidden="true" className="text-amber-400">
        {starsText(stars)}
      </span>
    </>
  );
}

/** Spec §32.6: the rating row at the bottom of a History record. */
export default function FeedbackRow({ feedback, editable, onRate }: FeedbackRowProps) {
  if (!editable) {
    if (!feedback) return null;
    return (
      <div className={SURFACE}>
        <span>
          Their rating: <Stars stars={feedback.stars} />
        </span>
        {feedback.comment && <p className="w-full whitespace-pre-wrap break-words pb-1 text-neutral-400">{feedback.comment}</p>}
      </div>
    );
  }
  return (
    <div className={SURFACE}>
      {feedback ? (
        <>
          <span>
            Your rating: <Stars stars={feedback.stars} />
          </span>
          <button type="button" onClick={onRate} className={LINK}>
            Edit
          </button>
        </>
      ) : (
        <button type="button" onClick={onRate} className={LINK}>
          Rate this conversation
        </button>
      )}
    </div>
  );
}
