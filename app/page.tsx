"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from "@clerk/nextjs";
import type { ScreenplayDoc } from "@/lib/scenes";
import {
  parseScreenplayPdf,
  parseScreenplayPdfOcr,
  type OcrProgress,
} from "@/lib/parser";
import { parseScreenplayPdfWithClaude, type ParseMeta } from "@/lib/claude-parser";
import { SceneReport } from "@/components/reports/SceneReport";
import { CharacterReport } from "@/components/reports/CharacterReport";
import { LocationReport } from "@/components/reports/LocationReport";
import { ExtraReport } from "@/components/reports/ExtraReport";
import { creditsForPages, PAGES_PER_CREDIT } from "@/lib/pricing";

type ReportKey = "scene" | "character" | "location" | "extra";

const REPORTS: { key: ReportKey; label: string }[] = [
  { key: "scene", label: "Scene Report" },
  { key: "character", label: "Character Report" },
  { key: "location", label: "Location Report" },
  { key: "extra", label: "Extra Cast Report" },
];

type ParseMode = "claude" | "fast" | "ocr";

interface MeInfo {
  credits: number | "unlimited";
  isAdmin: boolean;
}

export default function HomePage() {
  const { isSignedIn } = useUser();
  const [doc, setDoc] = useState<ScreenplayDoc | null>(null);
  const [active, setActive] = useState<ReportKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [rawBuffer, setRawBuffer] = useState<ArrayBuffer | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [parseMode, setParseMode] = useState<ParseMode>("claude");
  const [me, setMe] = useState<MeInfo | null>(null);
  const [lastMeta, setLastMeta] = useState<ParseMeta | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch credit balance whenever signed-in state changes or after a parse
  useEffect(() => {
    if (!isSignedIn) {
      setMe(null);
      return;
    }
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return;
        setMe({
          credits: d.isAdmin ? "unlimited" : (d.credits ?? 0),
          isAdmin: !!d.isAdmin,
        });
      })
      .catch(() => {});
  }, [isSignedIn, lastMeta]);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    setActive(null);
    setLastMeta(null);
    setLoadingLabel(
      parseMode === "claude"
        ? "Parsing with Claude API (30–90s)…"
        : "Parsing…",
    );
    try {
      const buf = await file.arrayBuffer();
      setRawBuffer(buf.slice(0));
      setFilename(file.name);
      if (parseMode === "claude") {
        const { doc: parsed, meta } = await parseScreenplayPdfWithClaude(buf.slice(0), {
          sourceName: file.name,
        });
        setDoc(parsed);
        setLastMeta(meta ?? null);
      } else {
        const parsed = await parseScreenplayPdf(buf, { sourceName: file.name });
        setDoc(parsed);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
      setLoadingLabel("");
    }
  }

  async function reparseWithOcr() {
    if (!rawBuffer) return;
    setOcrRunning(true);
    setOcrProgress({ page: 0, totalPages: 0, fraction: 0, stage: "loading" });
    setError(null);
    try {
      const parsed = await parseScreenplayPdfOcr(rawBuffer.slice(0), {
        sourceName: filename,
        onProgress: (p) => setOcrProgress(p),
      });
      setDoc(parsed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`OCR re-parse failed: ${msg}`);
    } finally {
      setOcrRunning(false);
      setOcrProgress(null);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && /\.pdf$/i.test(file.name)) handleFile(file);
  }

  const looksGarbled = !!doc && (doc.missingMarks ?? 0) > 5;

  return (
    <main className="min-h-screen">
      <header className="no-print border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Screenplay Report Generator
            </h1>
            <p className="text-xs text-neutral-500">
              Upload PDF · Claude Opus analyses Thai screenplay · clean reports
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SignedIn>
              {me && (
                <Link
                  href="/buy"
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-100"
                >
                  {me.credits === "unlimited" ? (
                    <span className="text-purple-700">∞ admin</span>
                  ) : (
                    <>
                      <span className="font-semibold">{me.credits}</span>{" "}
                      <span className="text-neutral-500">credits</span> · Buy
                    </>
                  )}
                </Link>
              )}
              {doc && (
                <button
                  onClick={() => {
                    setDoc(null);
                    setActive(null);
                    setFilename("");
                    setRawBuffer(null);
                    setLastMeta(null);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-100"
                >
                  Reset
                </button>
              )}
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
            <SignedOut>
              <SignInButton mode="modal">
                <button className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700">
                  Sign in
                </button>
              </SignInButton>
            </SignedOut>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <SignedOut>
          <section className="rounded-xl border border-neutral-200 bg-white p-10 text-center">
            <div className="text-3xl mb-3">🎬</div>
            <h2 className="text-xl font-semibold">
              Sign in to generate screenplay reports
            </h2>
            <p className="mt-2 text-sm text-neutral-500 max-w-md mx-auto">
              Free to try with included starter credits · pay-as-you-go after that ·
              ฿50 per up-to-50-page screenplay
            </p>
            <SignInButton mode="modal">
              <button className="mt-6 rounded-md bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-neutral-700">
                Sign in to continue
              </button>
            </SignInButton>
          </section>
        </SignedOut>

        <SignedIn>
          {!doc && (
            <section className="no-print">
              <div className="mb-4">
                <div className="inline-flex rounded-md border border-neutral-300 bg-white p-1 text-sm">
                  {(
                    [
                      { key: "claude", label: "Claude API (recommended)" },
                      { key: "fast", label: "Fast text-extract (free, no credits)" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setParseMode(opt.key)}
                      className={
                        "rounded px-3 py-1.5 font-medium " +
                        (parseMode === opt.key
                          ? "bg-neutral-900 text-white"
                          : "text-neutral-700 hover:bg-neutral-100")
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  {parseMode === "claude"
                    ? `Claude reads the PDF directly with full Thai tone marks. Uses ⌈pages/${PAGES_PER_CREDIT}⌉ credits.`
                    : "Browser-side text extraction. Free but Thai tone marks may be lost on some PDFs."}
                </p>
              </div>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 bg-white p-12 text-center"
              >
                <div className="mb-3 text-3xl">📄</div>
                <h2 className="text-base font-semibold">Upload screenplay PDF</h2>
                <p className="mt-1 max-w-md text-sm text-neutral-500">
                  Drop a file here or click to browse.
                </p>
                <label className="mt-5 inline-flex cursor-pointer items-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
                  Choose PDF
                  <input
                    ref={inputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    onChange={onPick}
                  />
                </label>
                {loading && (
                  <p className="mt-4 text-sm text-neutral-500">{loadingLabel}</p>
                )}
                {error && (
                  <div className="mt-4 max-w-md rounded-md border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-800">
                    {error}
                    {error.includes("เครดิตไม่พอ") && (
                      <Link
                        href="/buy"
                        className="ml-2 underline font-medium"
                      >
                        Buy credits →
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {doc && (
            <>
              <section className="no-print mb-6">
                <div className="rounded-lg bg-white border border-neutral-200 p-5">
                  <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                    <h2 className="text-base font-semibold">
                      {doc.title ?? filename}
                    </h2>
                    {doc.draftDate && (
                      <span className="text-xs text-neutral-500">
                        Draft {doc.draftDate}
                      </span>
                    )}
                    <span className="text-xs text-neutral-500">
                      {doc.totalScenes} scenes parsed
                    </span>
                    {lastMeta && !lastMeta.isAdmin && (
                      <span className="text-xs text-neutral-500">
                        · {lastMeta.creditsUsed} credit{lastMeta.creditsUsed !== 1 ? "s" : ""} used · {lastMeta.creditsRemaining} remaining
                      </span>
                    )}
                    {lastMeta?.isAdmin && (
                      <span className="text-xs text-purple-700">
                        · admin parse (no credits used)
                      </span>
                    )}
                  </div>

                  {looksGarbled && !ocrRunning && (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      <strong>Thai vowels look incomplete.</strong> Re-parse with OCR.
                      <div className="mt-2">
                        <button
                          onClick={reparseWithOcr}
                          className="rounded-md border border-amber-700 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                        >
                          Re-parse with OCR (~1–3 min)
                        </button>
                      </div>
                    </div>
                  )}

                  {ocrRunning && (
                    <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span>
                          Running OCR
                          {ocrProgress && ocrProgress.totalPages > 0
                            ? ` · page ${ocrProgress.page}/${ocrProgress.totalPages}`
                            : "…"}
                        </span>
                        <span className="text-xs text-neutral-500">
                          {ocrProgress ? `${Math.round(ocrProgress.fraction * 100)}%` : ""}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full rounded-full bg-neutral-200">
                        <div
                          className="h-1.5 rounded-full bg-neutral-900 transition-all"
                          style={{ width: `${Math.round((ocrProgress?.fraction ?? 0) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {error && <p className="mt-3 text-sm text-amber-700">{error}</p>}

                  <div className="mt-4 flex flex-wrap gap-3">
                    {REPORTS.map((r) => (
                      <button
                        key={r.key}
                        onClick={() => setActive(r.key)}
                        className={
                          "rounded-md px-4 py-2 text-sm font-medium border " +
                          (active === r.key
                            ? "bg-neutral-900 text-white border-neutral-900"
                            : "bg-white text-neutral-900 border-neutral-300 hover:bg-neutral-100")
                        }
                      >
                        Generate {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section>
                {active === "scene" && <SceneReport doc={doc} />}
                {active === "character" && <CharacterReport doc={doc} />}
                {active === "location" && <LocationReport doc={doc} />}
                {active === "extra" && <ExtraReport doc={doc} />}
                {!active && (
                  <div className="no-print rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
                    Pick a report above to display it.
                  </div>
                )}
              </section>
            </>
          )}
        </SignedIn>
      </div>
    </main>
  );
}
