import SignOutButton from "@/components/sign-out-button";
import { AUTH_CARD } from "@/lib/auth-card";

/** Spec §24.6: the pending and rejected screens. */
export default function StatusScreen({ status, email }: { status: "pending" | "rejected"; email: string }) {
  const pending = status === "pending";
  return (
    <div className="flex flex-1 items-center justify-center">
      <section className={AUTH_CARD}>
        <h1 className="text-lg font-semibold">{pending ? "Waiting for approval" : "Your request wasn't approved"}</h1>
        <p className="text-sm leading-relaxed text-neutral-400">
          {pending ? (
            <>
              Thanks for signing up, <span className="text-foreground">{email}</span>. Your request is waiting for approval:
              you&apos;ll get an email as soon as you&apos;re in.
            </>
          ) : (
            "This staging round is limited to a small group of testers, and your request wasn't approved."
          )}
        </p>
        <SignOutButton />
      </section>
    </div>
  );
}
