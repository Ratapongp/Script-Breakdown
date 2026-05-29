// Master-location detection.
//
// Two strategies, applied in order:
//   1. Hierarchical separator — "X/Y" or "X - Y" → master = X.
//   2. Keyword anchors — find the first occurrence of a known "building"
//      word and take the substring from that point. Anything before the
//      anchor is treated as a sub-location prefix.
//
// Both the input and the anchor list are normalised by stripping Thai
// combining diacritics (tone marks etc.) and C0 control chars before
// comparing, because Thai PDFs frequently lose those marks during text
// extraction. Display keeps whatever the PDF gave us.

// U+0000..U+001F controls; U+0E31, U+0E34..U+0E3A, U+0E47..U+0E4E Thai marks.
const COMBINING_RE = new RegExp(
  "[\\u0000-\\u001F\\u0E31\\u0E34-\\u0E3A\\u0E47-\\u0E4E]",
  "g",
);
function stripMarks(s: string): string {
  return s.replace(COMBINING_RE, "");
}

const ANCHORS_TH = [
  "บ้าน",                 // บ้าน  (house)
  "โรงเรียน", // โรงเรียน (school)
  "โรงพยาบาล", // โรงพยาบาล
  "โรงแรม",     // โรงแรม (hotel)
  "โรงงาน",     // โรงงาน (factory)
  "โรงพัก",     // โรงพัก (police station)
  "โรงหนัง", // โรงหนัง (cinema)
  "ออฟฟิศ",     // ออฟฟิศ (office)
  "สำนักงาน", // สำนักงาน
  "กองปราบ", // กองปราบ (police HQ)
  "สถานีตำรวจ", // สถานีตำรวจ
  "วัด",                       // วัด (temple)
  "โบสถ์",           // โบสถ์
  "ศูนย์การค้า", // ศูนย์การค้า
  "ห้าง",                 // ห้าง (mall)
  "ร้านอาหาร", // ร้านอาหาร
  "ร้านกาแฟ",      // ร้านกาแฟ
  "ร้าน",                 // ร้าน (shop)
  "ตลาด",                 // ตลาด (market)
  "สนาม",                 // สนาม (field)
  "สวน",                       // สวน (garden)
  "ค่าย",                 // ค่าย (camp)
  "คอนโด",           // คอนโด
  "อพาร์ตเมนต์", // อพาร์ตเมนต์
  "หมู่บ้าน",       // หมู่บ้าน
  "มหาวิทยาลัย", // มหาวิทยาลัย
  "สถานี",           // สถานี (station)
  "สนามบิน", // สนามบิน (airport)
  "ท่าเรือ", // ท่าเรือ (pier)
];

const ANCHORS_EN = [
  "House", "Home", "Apartment", "Condo", "Hotel", "Office",
  "School", "University", "Hospital", "Clinic",
  "Restaurant", "Cafe", "Café", "Bar", "Mall",
  "Police", "Station", "Temple", "Church",
  "Market", "Park", "Stadium", "Airport",
  "Studio", "Theatre", "Theater", "Factory",
];

const SUB_PREFIXES_TH = [
  "ห้อง",                 // ห้อง (room)
  "หน้า",                 // หน้า (front of)
  "หลัง",                 // หลัง (behind)
  "ภายใน",           // ภายใน (inside)
  "ภายนอก",     // ภายนอก (outside)
  "ทางเดิน", // ทางเดิน (corridor)
  "ระเบียง", // ระเบียง (balcony)
  "ในรถ",                 // ในรถ (in car)
  "บนรถ",                 // บนรถ
  "ลาน",                       // ลาน (yard)
  "บริเวณ",     // บริเวณ (area)
  "ศาลา",                 // ศาลา (pavilion)
];

interface AnchorEntry {
  raw: string;
  stripped: string;
}
const allAnchors: AnchorEntry[] = [...ANCHORS_TH, ...ANCHORS_EN].map((w) => ({
  raw: w,
  stripped: stripMarks(w),
}));
const subPrefixes: AnchorEntry[] = SUB_PREFIXES_TH.map((w) => ({
  raw: w,
  stripped: stripMarks(w),
}));

function findAnchor(
  loc: string,
): { index: number; length: number; word: string } | null {
  // Build a parallel map from stripped-position back into the original.
  const map: number[] = [];
  let orig = 0;
  const strippedChars: string[] = [];
  for (const ch of loc) {
    const s = stripMarks(ch);
    for (let i = 0; i < s.length; i++) {
      map.push(orig);
      strippedChars.push(s[i]);
    }
    orig += ch.length;
  }
  map.push(loc.length);
  const stripped = strippedChars.join("");

  let best: { index: number; length: number; word: string } | null = null;
  for (const a of allAnchors) {
    if (!a.stripped) continue;
    const idx = stripped.indexOf(a.stripped);
    if (idx < 0) continue;
    const realIdx = map[idx] ?? idx;
    const realEnd = map[idx + a.stripped.length] ?? loc.length;
    const length = realEnd - realIdx;
    if (
      !best ||
      realIdx < best.index ||
      (realIdx === best.index && length > best.length)
    ) {
      best = { index: realIdx, length, word: a.raw };
    }
  }
  return best;
}

function stripSubPrefix(loc: string): string | null {
  const stripped = stripMarks(loc);
  for (const p of subPrefixes) {
    if (!p.stripped) continue;
    if (stripped.startsWith(p.stripped)) {
      let needed = p.stripped.length;
      let i = 0;
      while (i < loc.length && needed > 0) {
        const ch = loc[i];
        needed -= stripMarks(ch).length;
        i += 1;
      }
      return loc.slice(i).trim();
    }
  }
  return null;
}

export function masterLocation(location: string): string {
  const raw = location.trim();
  if (!raw) return raw;

  const sepMatch = raw.match(/^([^/\\–—]+?)\s*[\/\\–—]\s*\S/);
  if (sepMatch) return sepMatch[1].trim();

  const anchor = findAnchor(raw);
  if (anchor && anchor.index > 0) {
    const candidate = raw.slice(anchor.index).trim();
    if (candidate.length >= 2) return candidate;
  }

  const stripped = stripSubPrefix(raw);
  if (stripped) {
    const sub = findAnchor(stripped);
    if (sub) return stripped.slice(sub.index).trim();
    return stripped;
  }

  return raw;
}
