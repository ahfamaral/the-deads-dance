"use client";

import { useBackButton } from "@/lib/use-back-handler";

/** 2026-10-17: starts the phone's back button handling on every page (see createBackButton). */
export default function BackButton() {
  useBackButton();
  return null;
}
