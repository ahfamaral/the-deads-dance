/**
 * The card behind the sign-in and status screens: near-opaque with a lit edge, so the text stays
 * readable over the background animation. Desktop content is 300px, the Turnstile widget's fixed width.
 */
export const AUTH_CARD =
  "flex w-full max-w-89 flex-col items-center gap-4 rounded-[20px] border border-white/14 bg-[#08080b]/95 px-5 py-7 text-center shadow-[0_0_0_1px_rgb(0_0_0/0.6),0_0_48px_rgb(190_205_255/0.1),inset_0_0_2px_rgb(220_230_255/0.35)] sm:px-7 sm:py-8";

/** Spec §27.4: the line under "Send code". It says the admin can read conversations. */
export const PRIVACY_NOTE =
  "Your conversations are stored on our server, so you can see them on any device. The admin can read them to improve the app. Delete one from History at any time.";
