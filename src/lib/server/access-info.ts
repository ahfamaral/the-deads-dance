import type { Pool } from "pg";
import type { Spend } from "@/lib/chat-types";
import { energyLeft, type Threshold } from "@/lib/energy";
import type { CurrentUser } from "./access";
import { spendToday } from "./spend";

/** Spec §26.5–6: what the screens need. A tester gets only a fraction; the admin gets spend. */
export type AccessBody = { energy: { left: number; warningRead: Threshold } } | { spend: { today: Spend } };

export async function accessBody(pool: Pick<Pool, "query">, user: CurrentUser): Promise<AccessBody> {
  if (user.role === "admin") return { spend: { today: await spendToday(pool, user.id) } };
  return { energy: { left: energyLeft(user.energy.balance, user.energy.full), warningRead: user.energy.warningRead } };
}
