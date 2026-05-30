"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CREDIT_PACKS, PAGES_PER_CREDIT } from "@/lib/pricing";

export default function BuyPage() {
  const params = useSearchParams();
  const success = params.get("success");
  const cancelled = params.get("cancelled");
  const [credits, setCredits] = useState<number | "loading" | "unlimited">("loading");
  const [loadingPack, setLoadingPack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setCredits(d.isAdmin ? "unlimited" : (d.credits ?? 0)))
      .catch(() => setCredits(0));
  }, [success]);

  async function buy(packId: string) {
    setLoadingPack(packId);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Checkout failed");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoadingPack(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold">Buy Credits</h1>
            <p className="text-xs text-neutral-500">
              1 credit = up to {PAGES_PER_CREDIT} pages · longer PDFs use ⌈pages/{PAGES_PER_CREDIT}⌉ credits
            </p>
          </div>
          <a
            href="/"
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
          >
            ← Back
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        {success && (
          <div className="mb-6 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            ✓ Payment received! Credits added to your account.
          </div>
        )}
        {cancelled && (
          <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Payment cancelled. No charge made.
          </div>
        )}
        {error && (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="mb-8 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wider text-neutral-500">
            Your balance
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {credits === "loading"
              ? "…"
              : credits === "unlimited"
                ? "∞ (admin)"
                : `${credits} credits`}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          {CREDIT_PACKS.map((p) => (
            <div
              key={p.id}
              className={
                "flex flex-col rounded-lg border bg-white p-5 " +
                (p.highlight
                  ? "border-neutral-900 ring-2 ring-neutral-900"
                  : "border-neutral-200")
              }
            >
              {p.highlight && (
                <div className="-mt-8 mb-3 self-center rounded-full bg-neutral-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
                  Most popular
                </div>
              )}
              <div className="text-xs uppercase tracking-wider text-neutral-500">
                {p.name}
              </div>
              <div className="mt-2 text-3xl font-semibold">
                ฿{p.amountTHB.toLocaleString()}
              </div>
              <div className="mt-1 text-sm text-neutral-600">
                {p.credits} credit{p.credits > 1 ? "s" : ""}
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                ฿{p.perCreditTHB}/credit
                {p.savePct ? ` · save ${p.savePct}%` : ""}
              </div>
              <button
                onClick={() => buy(p.id)}
                disabled={loadingPack !== null || credits === "unlimited"}
                className={
                  "mt-5 rounded-md px-4 py-2 text-sm font-medium transition " +
                  (p.highlight
                    ? "bg-neutral-900 text-white hover:bg-neutral-700"
                    : "border border-neutral-300 bg-white hover:bg-neutral-100") +
                  " disabled:opacity-50"
                }
              >
                {loadingPack === p.id ? "Redirecting…" : "Buy"}
              </button>
              <div className="mt-3 text-[10px] leading-relaxed text-neutral-400">
                Up to {p.credits * PAGES_PER_CREDIT} pages total
                <br />
                Cards · PromptPay
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-neutral-500">
          Credits never expire · pay-as-you-go · refunds within 7 days if no credits used
        </p>
      </div>
    </main>
  );
}
