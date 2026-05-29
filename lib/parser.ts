"use client";

import type { Scene, ScreenplayDoc, SceneType } from "./scenes";

// pdfjs-dist v4 ships ESM; we load the worker from a CDN pinned to the
// installed version so it works in Next.js without a custom webpack rule.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

let workerConfigured = false;
function ensureWorker() {
  if (workerConfigured) return;
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;
  workerConfigured = true;
}

// pdfjs emits U+0000 where the source font lacked a glyph (Thai combining
// marks are a common case). Strip the C0 control range outright.
const CTRL_RE = new RegExp("[\\u0000-\\u001F]", "g");

// ---------- Text extraction (fast path — pdfjs text content) ----------

interface RawLine {
  text: string;
  page: number;
}

async function extractLinesFast(
  data: ArrayBuffer,
): Promise<{ lines: RawLine[]; missingMarks: number }> {
  ensureWorker();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const lines: RawLine[] = [];
  let missingMarks = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map<number, { y: number; items: { x: number; str: string }[] }>();
    for (const it of tc.items as any[]) {
      const tr = it.transform as number[];
      const y = Math.round(tr[5]);
      const x = tr[4];
      if (!rows.has(y)) rows.set(y, { y, items: [] });
      rows.get(y)!.items.push({ x, str: it.str });
    }
    const ordered = Array.from(rows.values()).sort((a, b) => b.y - a.y);
    for (const r of ordered) {
      r.items.sort((a, b) => a.x - b.x);
      const raw = r.items.map((i) => i.str).join("");
      missingMarks += countMissingMarks(raw);
      const text = raw
        .replace(CTRL_RE, "")
        .replace(/\s+/g, " ")
        .trim();
      if (text) lines.push({ text, page: p });
    }
  }
  return { lines, missingMarks };
}

// ---------- Text extraction (OCR path — render + tesseract) ----------

export interface OcrProgress {
  page: number;
  totalPages: number;
  fraction: number;
  stage: "loading" | "rendering" | "recognizing" | "done";
}

async function extractLinesOcr(
  data: ArrayBuffer,
  onProgress?: (p: OcrProgress) => void,
  maxPages?: number,
): Promise<RawLine[]> {
  ensureWorker();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  onProgress?.({ page: 0, totalPages: pdf.numPages, fraction: 0, stage: "loading" });

  // Lazy-load tesseract.js so the initial bundle stays small.
  const Tesseract: any = await import("tesseract.js");
  const createWorker = Tesseract.createWorker;
  const worker = await createWorker(["tha", "eng"], 1, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
    langPath: "https://tessdata.projectnaptha.com/4.0.0_fast",
  });

  const lines: RawLine[] = [];
  const lastPage = maxPages ? Math.min(maxPages, pdf.numPages) : pdf.numPages;
  for (let p = 1; p <= lastPage; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    onProgress?.({
      page: p,
      totalPages: pdf.numPages,
      fraction: (p - 1) / pdf.numPages,
      stage: "rendering",
    });
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
    onProgress?.({
      page: p,
      totalPages: pdf.numPages,
      fraction: (p - 0.5) / pdf.numPages,
      stage: "recognizing",
    });
    const { data: { text } } = await worker.recognize(canvas);
    for (const raw of text.split(/\r?\n/)) {
      const cleaned = raw.replace(CTRL_RE, "").trim();
      if (cleaned) lines.push({ text: cleaned, page: p });
    }
    onProgress?.({
      page: p,
      totalPages: pdf.numPages,
      fraction: p / pdf.numPages,
      stage: "recognizing",
    });
  }
  await worker.terminate();
  onProgress?.({ page: pdf.numPages, totalPages: pdf.numPages, fraction: 1, stage: "done" });
  if (typeof window !== "undefined") {
    (window as any).__ocrLines = lines;
  }
  return lines;
}

// Exposed for in-browser debugging — OCR just the first N pages and dump
// the raw line stream to the console / window.__ocrLines.
export async function debugOcrFirstPages(
  data: ArrayBuffer,
  maxPages: number,
  onProgress?: (p: OcrProgress) => void,
): Promise<RawLine[]> {
  return extractLinesOcr(data, onProgress, maxPages);
}

// ---------- Heading + character-line parsing ----------

// We use two regexes so the parser also recognises headings whose INT/EXT
// label was mangled by OCR (e.g. "INT." may come back as "โมซ." or "ลฯ.").
//
// Strategy:
//   1. TIME_HEADING_RE — any "N ... - DAY/NIGHT/…" line is a scene heading,
//      whether or not "INT" is intact. We post-process the middle bit to
//      pull a clean type + location out.
//   2. MONTAGE_RE — "N MONTAGE [- description]" style headings that don't
//      carry a time-of-day.
const TIME_WORDS =
  "DAY|NIGHT|MORNING|EVENING|DUSK|DAWN|LATER|SUNSET|SUNRISE|CONTINUOUS|MAGIC\\s*HOUR|TWILIGHT|AFTERNOON|PRE[-\\s]*DAWN";

const TIME_HEADING_RE = new RegExp(
  "^(\\d{1,4})\\s+(.+?)\\s*[-\\u2013\\u2014]\\s*(" + TIME_WORDS + ")\\.?\\s*$",
  "i",
);

const MONTAGE_RE = new RegExp(
  "^(\\d{1,4})\\s+(MONTAGE|FLASHBACK|DREAM|PRESENT|INTERCUT|SERIES\\s+OF\\s+SHOTS)\\b" +
    "(?:\\s*[-\\u2013\\u2014:]?\\s*(.+?))?\\s*$",
  "i",
);

// Pull the INT/EXT label out of the middle chunk. Be tolerant of OCR
// noise — if the chunk starts with a short token followed by a dot, treat
// the rest as the location and default the type to INT.
const TYPE_PREFIX_RE = new RegExp(
  "^\\s*(INT\\.?\\/?EXT\\.?|EXT\\.?\\/?INT\\.?|INT\\.?|EXT\\.?|I\\.?\\/?E\\.?)\\.?\\s*(.*)$",
  "i",
);
const GARBAGE_PREFIX_RE = /^\s*\S{1,5}\.\s*(\S.*)$/;

function dissectMiddle(middle: string): { type: SceneType; location: string } {
  const t = TYPE_PREFIX_RE.exec(middle);
  if (t) return { type: normaliseType(t[1]), location: t[2].trim() };
  const g = GARBAGE_PREFIX_RE.exec(middle);
  if (g) return { type: "INT", location: g[1].trim() };
  return { type: "INT", location: middle.trim() };
}

const CHAR_LINE_RE = /^\(([^)]+)\)\s*$/;

function normaliseType(raw: string): SceneType {
  const t = raw.toUpperCase().replace(/\./g, "").replace(/\s+/g, "");
  if (t === "INT") return "INT";
  if (t === "EXT") return "EXT";
  if (t === "MONTAGE") return "MONTAGE";
  if (t === "FLASHBACK") return "FLASHBACK";
  if (t === "DREAM") return "DREAM";
  if (t === "PRESENT") return "PRESENT";
  if (t === "INTERCUT") return "INTERCUT";
  if (t === "SERIESOFSHOTS") return "SERIES OF SHOTS";
  return "INT/EXT";
}

function splitCharacters(inner: string): { characters: string[]; extras: string[] } {
  const parts = inner
    .split(/[,，]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const characters: string[] = [];
  const extras: string[] = [];
  for (const p of parts) {
    const m =
      p.match(/^EXTRA[\s:：\-—]*([\s\S]+)$/i) ||
      p.match(/^เอ็กซ์ตร[า้]\s*[:：\-]*\s*([\s\S]+)$/);
    if (m) extras.push(m[1].trim());
    else characters.push(p);
  }
  return { characters, extras };
}

const HEADER_FOOTER_RE = /^(\d+\s+)?Screenplay\b|^\|\s*\d+\s*$|^Page\s+\d+/i;
const PAGE_NUM_RE = /^\d+\s*\/\s*\d+$|^- ?\d+ ?-$|^\|\s*\d+$/;

function isJunk(line: string): boolean {
  return HEADER_FOOTER_RE.test(line) || PAGE_NUM_RE.test(line);
}

// ---------- Stats / heuristics ----------

export function countMissingMarks(text: string): number {
  let n = 0;
  for (const c of text) if (c.charCodeAt(0) === 0) n += 1;
  return n;
}

// ---------- Common parse logic ----------

function parseFromLines(
  lines: RawLine[],
  opts: { sourceName?: string; missingMarks?: number },
): ScreenplayDoc {
  let title: string | undefined;
  let draftDate: string | undefined;
  const headerLine = lines.find((l) => /Screenplay/i.test(l.text));
  if (headerLine) {
    const m = headerLine.text.match(
      /(\d{6,8})\s+Screenplay\s+(.+?)(?:\s+\|\s+\d+)?$/i,
    );
    if (m) {
      draftDate = formatThaiDate(m[1]);
      title = m[2].trim();
    }
  }
  if (!title && opts.sourceName) {
    title = opts.sourceName.replace(/\.[^.]+$/, "");
  }

  type ProtoScene = Omit<Scene, "summary"> & { actionLines: string[] };
  const scenes: ProtoScene[] = [];
  let current: ProtoScene | null = null;
  let awaitingCharLine = false;
  let charLookahead = 0;

  for (const raw of lines) {
    const line = raw.text;
    if (isJunk(line)) continue;
    let proto: ProtoScene | null = null;

    const timeMatch = line.match(TIME_HEADING_RE);
    if (timeMatch) {
      const [, num, middle, time] = timeMatch;
      const { type, location } = dissectMiddle(middle);
      proto = {
        number: parseInt(num, 10),
        type,
        location,
        timeOfDay: time.trim().toUpperCase().replace(/\s+/g, " "),
        characters: [],
        extras: [],
        rawHeading: line,
        action: "",
        actionLines: [],
      };
    } else {
      const montageMatch = line.match(MONTAGE_RE);
      if (montageMatch) {
        const [, num, kind, desc] = montageMatch;
        const sceneType = normaliseType(kind);
        proto = {
          number: parseInt(num, 10),
          type: sceneType,
          location: (desc || "").trim() || sceneType,
          timeOfDay: "",
          characters: [],
          extras: [],
          rawHeading: line,
          action: "",
          actionLines: [],
        };
      }
    }

    if (proto) {
      if (current) scenes.push(current);
      current = proto;
      awaitingCharLine = true;
      charLookahead = 0;
      continue;
    }
    if (!current) continue;
    if (awaitingCharLine) {
      const cm = line.match(CHAR_LINE_RE);
      if (cm) {
        const { characters, extras } = splitCharacters(cm[1]);
        current.characters = characters;
        current.extras = extras;
        awaitingCharLine = false;
        continue;
      }
      // OCR often inserts a stray 1–3 char "ฐั", "ye", "x" garbage line
      // between the heading and the real character list. Tolerate up to
      // 4 such short lines before giving up on awaiting the char list.
      if (line.length <= 6 && charLookahead < 4) {
        charLookahead += 1;
        continue;
      }
      awaitingCharLine = false;
    }
    current.actionLines.push(line);
  }
  if (current) scenes.push(current);

  const finalScenes: Scene[] = scenes.map((s) => ({
    number: s.number,
    type: s.type,
    location: s.location,
    timeOfDay: s.timeOfDay,
    characters: s.characters,
    extras: s.extras,
    rawHeading: s.rawHeading,
    action: s.actionLines.join("\n"),
    summary: "",
  }));

  return {
    title,
    draftDate,
    scenes: finalScenes,
    totalScenes: finalScenes.length,
    parsedAt: new Date(),
    sourceName: opts.sourceName,
    missingMarks: opts.missingMarks ?? 0,
  };
}

// ---------- Public entry points ----------

export async function parseScreenplayPdf(
  data: ArrayBuffer,
  opts: { sourceName?: string } = {},
): Promise<ScreenplayDoc> {
  const { lines, missingMarks } = await extractLinesFast(data);
  return parseFromLines(lines, { ...opts, missingMarks });
}

export async function parseScreenplayPdfOcr(
  data: ArrayBuffer,
  opts: { sourceName?: string; onProgress?: (p: OcrProgress) => void } = {},
): Promise<ScreenplayDoc> {
  const lines = await extractLinesOcr(data, opts.onProgress);
  return parseFromLines(lines, { ...opts, missingMarks: 0 });
}

function formatThaiDate(yymmdd: string): string {
  if (/^\d{6}$/.test(yymmdd)) {
    const dd = yymmdd.slice(0, 2);
    const mm = yymmdd.slice(2, 4);
    const yy = yymmdd.slice(4, 6);
    return `${dd}/${mm}/${yy}`;
  }
  if (/^\d{8}$/.test(yymmdd)) {
    const dd = yymmdd.slice(0, 2);
    const mm = yymmdd.slice(2, 4);
    const yyyy = yymmdd.slice(4);
    return `${dd}/${mm}/${yyyy}`;
  }
  return yymmdd;
}
