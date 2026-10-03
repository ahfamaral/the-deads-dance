"use client";

import { useEffect, useRef } from "react";

/** Spec §24.6: one input (paste and autofill work), drawn as six boxes. Calls onComplete on the 6th digit. */
export default function CodeInput({ value, onChange, onComplete, disabled }: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // A disabled input loses focus, which closes the phone keyboard. Take it back once enabled.
  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);
  return (
    <label className="relative block w-full">
      <span className="sr-only">6-digit code</span>
      <input
        ref={ref}
        autoFocus
        value={value}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={12}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
          onChange(digits);
          if (digits.length === 6) onComplete(digits);
        }}
        className="absolute inset-0 h-full w-full opacity-0"
      />
      <span aria-hidden="true" className="flex w-full justify-center gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className={`flex h-12 min-w-0 max-w-10 flex-1 items-center justify-center rounded-xl border text-lg ${
              i === value.length ? "border-white/60" : "border-white/20"
            }`}
          >
            {value[i] ?? ""}
          </span>
        ))}
      </span>
    </label>
  );
}
