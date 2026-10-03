import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/server/auth";

// A function, not the instance, so `next build` doesn't need the auth env.
export const { GET, POST } = toNextJsHandler((request) => getAuth().handler(request));
