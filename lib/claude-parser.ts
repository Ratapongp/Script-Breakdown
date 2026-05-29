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

interface ClaudeApiResponse {
  title: string | null;
  draft_date: string | null;
  scenes: ClaudeScene[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
}

function normaliseType(raw: string): SceneType {
  const t = raw.toUpperCase().trim();
  if (
    t === "INT" ||
    t === "EXT" ||
    t === "INT/EXT" ||
    t === "MONTAGE" ||
    t === "FLASHBACK" ||
    t === "DREAM" ||
    t === "PRESENT" ||
    t === "INTERCUT" ||
    t === "SERIES OF SHOTS"
  ) {
    return t;
  }
  return "INT";
}

export async function parseScreenplayPdfWithClaude(
  data: ArrayBuffer,
  opts: { sourceName?: string } = {},
): Promise<ScreenplayDoc> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([data], { type: "application/pdf" }),
    opts.sourceName ?? "screenplay.pdf",
  );

  const res = await fetch("/api/parse", { method: "POST", body: form });
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j.error ?? JSON.stringify(j);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Claude parse failed (${res.status}): ${detail}`);
  }

  const json = (await res.json()) as ClaudeApiResponse;

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
    title: json.title ?? opts.sourceName?.replace(/\.[^.]+$/, ""),
    draftDate: json.draft_date ?? undefined,
    scenes,
    totalScenes: scenes.length,
    parsedAt: new Date(),
    sourceName: opts.sourceName,
    missingMarks: 0,
  };
}
