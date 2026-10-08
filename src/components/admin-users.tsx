"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AddEnergyDialog from "@/components/add-energy-dialog";
import AdminCredit from "@/components/admin-credit";
import ConfirmDialog from "@/components/confirm-dialog";
import { energyCell } from "@/lib/admin-spend";
import { energyLeft, levelOf, type EnergyLevel } from "@/lib/energy";
import { formatDollars } from "@/lib/money";

type Status = "pending" | "approved" | "rejected" | "blocked";
type Row = {
  id: string;
  email: string;
  role: string;
  status: Status;
  createdAt: string;
  statusChangedAt: string | null;
  statusChangedByEmail: string | null;
  energyBalance: number;
  energyFull: number;
  spent: number;
};
const TABS: { status: Status; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "approved", label: "Approved" },
  { status: "rejected", label: "Rejected" },
  { status: "blocked", label: "Blocked" },
];
const BTN_PRIMARY = "min-h-11 flex-1 whitespace-nowrap rounded-full bg-neutral-100 px-1.5 py-1.5 text-[length:clamp(10px,2.9vw,12px)] font-semibold text-neutral-900 hover:bg-white md:flex-none md:px-4 md:text-sm md:font-semibold";
const BTN = "min-h-11 flex-1 whitespace-nowrap rounded-full border border-white/15 px-1.5 py-1.5 text-[length:clamp(10px,2.9vw,12px)] text-neutral-200 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent md:flex-none md:px-4 md:text-sm";
const BACK = "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border border-white/15 px-4 text-sm text-neutral-200 hover:bg-white/10";
const BTN_DANGER = "min-h-11 flex-1 whitespace-nowrap rounded-full border border-red-500/50 px-1.5 py-1.5 text-[length:clamp(10px,2.9vw,12px)] text-red-300 hover:bg-red-500/15 md:flex-none md:px-4 md:text-sm";

// Same colours as EnergyBar, without the pulse or the icon.
const MINI_FILL: Record<EnergyLevel, string> = { green: "bg-green-500", yellow: "bg-yellow-400", red: "bg-red-500", darkred: "bg-red-800", empty: "" };

function EnergyBarMini({ balance, full }: { balance: number; full: number }) {
  const left = energyLeft(balance, full);
  return (
    <span aria-hidden="true" className="block h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-white/10">
      <span className={`block h-full rounded-full ${MINI_FILL[levelOf(left)]}`} style={{ width: `${Math.round(left * 100)}%` }} />
    </span>
  );
}

// The actions that ask first, with their dialog and the note shown after.
type Confirmed = "reject" | "block" | "unblock" | "empty";
const CONFIRM: Record<Confirmed, { label: string; message: string; done: string }> = {
  reject: { label: "Reject", message: "They'll see that their request wasn't approved. This can't be undone yet.", done: "Rejected" },
  block: { label: "Block", message: "They'll be signed out everywhere and can't sign in until you unblock them.", done: "Blocked" },
  unblock: { label: "Unblock", message: "They'll be able to sign in again, with the access they had before.", done: "Unblocked" },
  empty: { label: "Empty energy", message: "Their energy goes to 0, and they can't talk until you add more.", done: "Emptied the energy of" },
};

/** The user list, or null when it couldn't be loaded. */
async function fetchUsers(): Promise<Row[] | null> {
  const res = await fetch("/api/admin/users");
  return res.ok ? (await res.json()).users : null;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

/** Spec §24.6: tabs per status; a table on desktop, cards on phones. */
export default function AdminUsers({ adminId }: { adminId: string }) {
  const [users, setUsers] = useState<Row[] | null>(null);
  const [tab, setTab] = useState<Status>("pending");
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: Row; action: Confirmed } | null>(null);
  const [defaultAmount, setDefaultAmount] = useState("1.00");
  const [adding, setAdding] = useState<Row | null>(null);
  const [changes, setChanges] = useState(0);
  const onStartingEnergy = useCallback((v: string) => setDefaultAmount(v), []);

  const showUsers = useCallback((list: Row[] | null) => (list ? setUsers(list) : setNote("Couldn't load users.")), []);
  const reloadUsers = async () => showUsers(await fetchUsers());

  useEffect(() => {
    void fetchUsers().then(showUsers);
  }, [showUsers]);

  async function act(row: Row, action: "approve" | Confirmed) {
    const id = encodeURIComponent(row.id);
    const res =
      action === "empty"
        ? await fetch(`/api/admin/users/${id}/energy`, { method: "DELETE" })
        : await fetch(`/api/admin/users/${id}/${action}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setNote(data.error ?? "That didn't work.");
    else if (action === "approve") setNote(`Approved ${row.email} · ${data.emailSent ? "email sent" : "email failed"}`);
    else setNote(`${CONFIRM[action].done} ${row.email}`);
    if (res.ok) setChanges((n) => n + 1);
    await reloadUsers();
  }

  async function addEnergy(row: Row, amount: string) {
    setAdding(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(row.id)}/energy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json().catch(() => ({}));
      setNote(res.ok ? `Added ${data.added} for ${row.email}` : (data.error ?? "That didn't work."));
      if (res.ok) setChanges((n) => n + 1);
    } catch {
      setNote("Couldn't reach the server.");
    }
    await reloadUsers();
  }

  const rows = (users ?? []).filter((u) => (u.role === "admin" ? tab === "approved" : u.status === tab));
  const count = (s: Status) => (users ?? []).filter((u) => (u.role === "admin" ? s === "approved" : u.status === s)).length;

  function actions(row: Row) {
    if (row.role === "admin" || row.id === adminId) return null;
    if (row.status === "pending")
      return (
        <>
          <button type="button" className={BTN} onClick={() => setConfirm({ row, action: "reject" })}>
            Reject
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={() => void act(row, "approve")}>
            Approve
          </button>
        </>
      );
    if (row.status === "approved")
      return (
        <>
          <button type="button" className={BTN_PRIMARY} onClick={() => setAdding(row)}>
            Add energy
          </button>
          <button type="button" className={BTN} disabled={row.energyBalance === 0} onClick={() => setConfirm({ row, action: "empty" })}>
            Empty
          </button>
          <button type="button" className={BTN_DANGER} onClick={() => setConfirm({ row, action: "block" })}>
            Block
          </button>
        </>
      );
    if (row.status === "blocked")
      return (
        <button type="button" className={BTN} onClick={() => setConfirm({ row, action: "unblock" })}>
          Unblock
        </button>
      );
    return null;
  }
  const dateOf = (r: Row) => (tab === "pending" ? when(r.createdAt) : when(r.statusChangedAt));
  const energyOf = (r: Row) =>
    r.role === "admin" ? (
      <span className="text-neutral-500">No limit</span>
    ) : (
      <span className="flex items-center gap-2">
        <EnergyBarMini balance={r.energyBalance} full={r.energyFull} />
        {energyCell(r.energyBalance, r.energyFull)}
      </span>
    );
  const byOf = (r: Row) => (r.role === "admin" ? "CLI" : r.statusChangedByEmail === null ? "—" : "you");

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex items-center gap-3">
        <Link href="/" className={BACK}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </Link>
        <h1 className="text-lg font-semibold">Testers</h1>
      </header>

      <AdminCredit refresh={changes} onStartingEnergy={onStartingEnergy} />

      <div role="tablist" className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.status}
            role="tab"
            aria-selected={tab === t.status}
            onClick={() => setTab(t.status)}
            className={`min-h-11 shrink-0 rounded-full border px-4 text-sm ${tab === t.status ? "border-neutral-100 bg-neutral-100 font-semibold text-neutral-900" : "border-white/15 bg-neutral-900/70 text-neutral-300 backdrop-blur-sm"
              }`}
          >
            {t.label}{" "}
            <span className={t.status === "pending" && count("pending") > 0 ? "rounded-md bg-amber-500 px-1.5 font-bold text-neutral-900" : ""}>
              {count(t.status)}
            </span>
          </button>
        ))}
      </div>

      {note && (
        <p role="status" className="rounded-xl border border-white/10 bg-neutral-900/70 px-3 py-2 text-sm text-neutral-300">
          {note}
        </p>
      )}

      {users === null ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Nobody here.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-900/50">
          {/* Desktop: a table */}
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
                <th className="px-2 py-2 font-medium">Email</th>
                <th className="px-2 py-2 font-medium">{tab === "pending" ? "Signed up" : "Changed"}</th>
                {tab !== "pending" && <th className="px-2 py-2 font-medium">By</th>}
                {tab === "approved" && <th className="px-2 py-2 font-medium">Energy left</th>}
                {tab === "approved" && <th className="px-2 py-2 font-medium">Spent</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="break-all px-2 py-2">
                    {r.email} {r.role === "admin" && <span className="text-neutral-500">(admin)</span>}
                  </td>
                  <td className="px-2 py-2 text-neutral-400">{dateOf(r)}</td>
                  {tab !== "pending" && <td className="px-2 py-2 text-neutral-400">{byOf(r)}</td>}
                  {tab === "approved" && <td className="px-2 py-2">{energyOf(r)}</td>}
                  {tab === "approved" && <td className="px-2 py-2 text-neutral-400">{formatDollars(r.spent)}</td>}
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-2">{actions(r)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Phone: cards */}
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="rounded-2xl border border-white/10 bg-neutral-900/90 p-3">
                <p className="break-all text-sm">
                  {r.email} {r.role === "admin" && <span className="text-neutral-500">(admin)</span>}
                </p>
                <p className="mb-2 text-xs text-neutral-500">
                  {tab === "pending" ? `Signed up ${dateOf(r)}` : `${dateOf(r)} · by ${byOf(r)}`}
                  {tab === "approved" && ` · spent ${formatDollars(r.spent)}`}
                </p>
                {tab === "approved" && <div className="my-1.5 text-sm">{energyOf(r)}</div>}
                <div className="flex gap-2">{actions(r)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? `${CONFIRM[confirm.action].label} ${confirm.row.email}?` : ""}
        message={confirm ? CONFIRM[confirm.action].message : ""}
        confirmLabel={confirm ? CONFIRM[confirm.action].label : undefined}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c) void act(c.row, c.action);
        }}
        onCancel={() => setConfirm(null)}
      />
      <AddEnergyDialog
        open={adding !== null}
        email={adding?.email ?? ""}
        balance={adding?.energyBalance ?? 0}
        defaultAmount={defaultAmount}
        onAdd={(a) => adding && void addEnergy(adding, a)}
        onCancel={() => setAdding(null)}
      />
    </section>
  );
}
