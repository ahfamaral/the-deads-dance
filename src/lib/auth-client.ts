import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

/** The browser's side of Better Auth (spec §24.4). Same origin, so no baseURL. */
export const authClient = createAuthClient({ plugins: [emailOTPClient()] });
