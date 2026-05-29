import { compressNumbers } from "./compress";
import { masterLocation } from "./locations";

export type SceneType =
  | "INT"
  | "EXT"
  | "INT/EXT"
  | "MONTAGE"
  | "FLASHBACK"
  | "DREAM"
  | "PRESENT"
  | "INTERCUT"
  | "SERIES OF SHOTS";

export interface Scene {
  number: number;
  type: SceneType;
  location: string;
  timeOfDay: string;
  characters: string[];
  extras: string[];
  summary: string;
  rawHeading: string;
  action: string;
}

export interface ScreenplayDoc {
  title?: string;
  draftDate?: string;
  scenes: Scene[];
  totalScenes: number;
  parsedAt: Date;
  sourceName?: string;
  /** Count of U+0000 placeholders found in the first 200 lines of text.
   *  High values mean the font's ToUnicode CMap was incomplete and the user
   *  should consider re-parsing with OCR. */
  missingMarks?: number;
}

export interface CharacterRow {
  rank: number;
  name: string;
  scenesText: string;
  totalScenes: number;
  scenes: number[];
}

export interface LocationRow {
  master: string;
  scenesText: string;
  totalScenes: number;
  scenes: number[];
  sublocations: string[];
}

export interface ExtraRow {
  scene: number;
  location: string;
  description: string;
}

// ---------- Aggregations ----------

export function buildCharacterReport(doc: ScreenplayDoc): CharacterRow[] {
  const map = new Map<string, number[]>();
  for (const s of doc.scenes) {
    for (const c of s.characters) {
      if (!map.has(c)) map.set(c, []);
      map.get(c)!.push(s.number);
    }
  }
  const rows = Array.from(map.entries())
    .map(([name, scenes]) => ({
      name,
      scenes: Array.from(new Set(scenes)).sort((a, b) => a - b),
    }))
    .sort((a, b) =>
      b.scenes.length - a.scenes.length || a.name.localeCompare(b.name, "th"),
    );

  return rows.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    scenes: r.scenes,
    scenesText: compressNumbers(r.scenes),
    totalScenes: r.scenes.length,
  }));
}

export function buildLocationReport(doc: ScreenplayDoc): LocationRow[] {
  const map = new Map<string, { scenes: number[]; subs: Set<string> }>();
  for (const s of doc.scenes) {
    const master = masterLocation(s.location) || s.location;
    if (!map.has(master)) map.set(master, { scenes: [], subs: new Set() });
    const bucket = map.get(master)!;
    bucket.scenes.push(s.number);
    if (s.location !== master) bucket.subs.add(s.location);
  }
  return Array.from(map.entries())
    .map(([master, bucket]) => {
      const scenes = Array.from(new Set(bucket.scenes)).sort((a, b) => a - b);
      return {
        master,
        scenes,
        scenesText: compressNumbers(scenes),
        totalScenes: scenes.length,
        sublocations: Array.from(bucket.subs).sort(),
      };
    })
    .sort(
      (a, b) =>
        b.totalScenes - a.totalScenes || a.master.localeCompare(b.master, "th"),
    );
}

export function buildExtraReport(doc: ScreenplayDoc): ExtraRow[] {
  const rows: ExtraRow[] = [];
  for (const s of doc.scenes) {
    for (const e of s.extras) {
      rows.push({ scene: s.number, location: s.location, description: e });
    }
  }
  return rows.sort((a, b) => a.scene - b.scene);
}

export function formatHeading(s: Scene): string {
  const isMontageLike =
    s.type === "MONTAGE" ||
    s.type === "FLASHBACK" ||
    s.type === "DREAM" ||
    s.type === "PRESENT" ||
    s.type === "INTERCUT" ||
    s.type === "SERIES OF SHOTS";
  const head = isMontageLike ? s.type : `${s.type}.`;
  const loc = s.location && s.location !== s.type ? ` ${s.location}` : "";
  const time = s.timeOfDay ? ` - ${s.timeOfDay}` : "";
  return `${head}${loc}${time}`.trim();
}
