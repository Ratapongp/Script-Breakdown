"use client";

import type { Scene, ScreenplayDoc, SceneType } from "./scenes";

interface ClaudeScene {
  number: number;
  type: string;
  location: string;
  time_of_day: string;
  characters: string[];
  extras: string[];
}

export interface ParseMeta {
  pageCount: number;
  creditsUsed: number;
  creditsRemaining: number | "unlimited";
  isAdmin: boolean;
  durationMs: number;
}

export type ParseProgress =
  | { phase: "starting"; pageCount: number; creditsRequired: number; isAdmin: boolean }
  | { phase: "claude_streaming" }
  | { phase: "tick"; elapsedMs: number; chars: number }
  | { phase: "done" }
  | { phase: "error"; error: string };

function normaliseType(raw: string): SceneType {
  const t = raw.toUpperCase().trim();
  const allowed: SceneType[] = [
    "INT", "EXT", "INT/EXT", "MONTAGE", "FLASHBACK",
    "DREAM", "PRESENT", "INTERCUT", "SERIES OF SHOTS",
  ];
  return (allowed.includes(t as SceneType) ? (t as SceneType) : "INT");
}

export interface ClaudeParseResult {
  doc: ScreenplayDoc;
  meta?: ParseMeta;
}

export async function parseScreenplayPdfWithClaude(
  data: ArrayBuffer,
  opts: { sourceName?: string; onProgress?: (p: ParseProgress) => void } = {},
): Promise<ClaudeParseResult> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([data], { type: "application/pdf" }),
    opts.sourceName ?? "screenplay.pdf",
  );

  const res = await fetch("/api/parse", { method: "POST", body: form });

  // Non-streaming JSON error (auth, credits, validation)
  if (!res.ok) {
    let json: { error?: string; required?: number; balance?: number; pageCount?: number };
    try {
      json = await res.json();
    } catch {
      throw new Error(`Parse failed (${res.status})`);
    }
    if (res.status === 402) {
      throw new Error(
        `เครดิตไม่พอ — บทหนัง ${json.pageCount} หน้า ใช้ ${json.required} credits แต่คุณเหลือ ${json.balance} credits`,
      );
    }
    if (res.status === 401) throw new Error("กรุณา sign in ก่อนใช้งาน");
    throw new Error(json.error ?? `Parse failed (${res.status})`);
  }

  if (!res.body) throw new Error("No response body");

  // Stream of NDJSON events
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result:
    | {
        title: string | null;
        draft_date: string | null;
        scenes: ClaudeScene[];
        meta: ParseMeta;
      }
    | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const e = event as { phase: string; result?: typeof result; error?: string };
      if (e.phase === "done" && e.result) {
        result = e.result;
        opts.onProgress?.({ phase: "done" });
      } else if (e.phase === "error") {
        throw new Error(e.error ?? "Unknown parse error");
      } else {
        opts.onProgress?.(e as ParseProgress);
      }
    }
  }

  if (!result) throw new Error("Parse stream ended without result");

  const scenes: Scene[] = result.scenes.map((s) => {
    const type = normaliseType(s.type);
    return {
      number: s.number,
      type,
      location: s.location || "",
      timeOfDay: (s.time_of_day || "").toUpperCase(),
      characters: s.characters ?? [],
      extras: s.extras ?? [],
      rawHeading: `${s.number} ${type}. ${s.location} - ${s.time_of_day}`.trim(),
      action: "",
      summary: "",
    };
  });

  return {
    doc: {
      title: result.title ?? opts.sourceName?.replace(/\.[^.]+$/, ""),
      draftDate: result.draft_date ?? undefined,
      scenes,
      totalScenes: scenes.length,
      parsedAt: new Date(),
      sourceName: opts.sourceName,
      missingMarks: 0,
    },
    meta: result.meta,
  };
}
