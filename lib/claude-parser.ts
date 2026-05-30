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

interface ClaudeApiResponse {
  title: string | null;
  draft_date: string | null;
  scenes: ClaudeScene[];
  meta?: ParseMeta;
}

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
  opts: { sourceName?: string } = {},
): Promise<ClaudeParseResult> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([data], { type: "application/pdf" }),
    opts.sourceName ?? "screenplay.pdf",
  );

  const res = await fetch("/api/parse", { method: "POST", body: form });
  const json = (await res.json()) as ClaudeApiResponse & {
    error?: string;
    required?: number;
    balance?: number;
    pageCount?: number;
  };

  if (!res.ok) {
    if (res.status === 402) {
      throw new Error(
        `เครดิตไม่พอ — บทหนัง ${json.pageCount} หน้า ใช้ ${json.required} credits แต่คุณเหลือ ${json.balance} credits`,
      );
    }
    if (res.status === 401) {
      throw new Error("กรุณา sign in ก่อนใช้งาน");
    }
    throw new Error(json.error ?? `Parse failed (${res.status})`);
  }

  const scenes: Scene[] = json.scenes.map((s) => {
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
      title: json.title ?? opts.sourceName?.replace(/\.[^.]+$/, ""),
      draftDate: json.draft_date ?? undefined,
      scenes,
      totalScenes: scenes.length,
      parsedAt: new Date(),
      sourceName: opts.sourceName,
      missingMarks: 0,
    },
    meta: json.meta,
  };
}
