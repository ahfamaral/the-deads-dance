/** Spec §24.8: a production server with missing auth env stops at startup, not on the first sign-in. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { readAuthEnv } = await import("@/lib/server/auth-env");
    readAuthEnv();
  }
}
