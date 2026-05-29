// Standalone test of the Claude PDF parsing logic — bypasses Next.js entirely.
// Run with: node scripts/test-claude.mjs
import { readFileSync } from "node:fs";
import { config } from "dotenv";
config({ path: ".env.local" });
import Anthropic from "@anthropic-ai/sdk";

const SCREENPLAY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: ["string", "null"] },
    draft_date: { type: ["string", "null"] },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          number: { type: "number" },
          type: {
            type: "string",
            enum: ["INT","EXT","INT/EXT","MONTAGE","FLASHBACK","DREAM","PRESENT","INTERCUT","SERIES OF SHOTS"],
          },
          location: { type: "string" },
          time_of_day: { type: "string" },
          characters: { type: "array", items: { type: "string" } },
          extras: { type: "array", items: { type: "string" } },
        },
        required: ["number","type","location","time_of_day","characters","extras"],
      },
    },
  },
  required: ["title","draft_date","scenes"],
};

const SYSTEM_PROMPT = `You are an expert script supervisor and screenplay breakdown analyst specialising in Thai screenplays.

Read the attached PDF and extract EVERY scene as structured JSON.

RULES:
1. Include every numbered scene from 1 to the last. Include MONTAGE, FLASHBACK, DREAM, INTERCUT, PRESENT, "SERIES OF SHOTS" when they are numbered.
2. Use Thai text EXACTLY with ALL tone marks and vowels (ล่า, บ้าน, ห้อง, ผึ้ง).
3. Normalise character name spelling — one consistent canonical spelling per character across all scenes.
4. The characters appearing in the scene are in parentheses on the line after the heading, comma-separated.
5. EXTRA entries inside the parens (prefixed with the word "EXTRA") go in extras[], not characters[].
6. "type" must be one of: INT, EXT, INT/EXT, MONTAGE, FLASHBACK, DREAM, PRESENT, INTERCUT, SERIES OF SHOTS.
7. "location" is the FULL Thai location string (e.g., "ห้องครัวบ้านมธุสร", not "ห้องครัว").
8. "time_of_day" uppercased (DAY, NIGHT, …) or "" if absent.
9. "title" is the episode title from the header (e.g., "ล่า EP.1"). "draft_date" is "DD/MM/YY" from the leading number (e.g., "290669" → "29/06/69") or null.

Return ONLY the JSON. No markdown, no commentary.`;

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY missing in .env.local");
  process.exit(1);
}

const pdfPath = "/Users/ratapong/Desktop/ล่า EP1 290669 .pdf";
const base64 = readFileSync(pdfPath).toString("base64");
console.log(`PDF size: ${(base64.length / 1024 / 1024).toFixed(2)} MB (base64)`);

const client = new Anthropic({ apiKey });
console.log("Streaming Claude Opus 4.8…");
const t0 = Date.now();

const stream = client.messages.stream({
  model: "claude-opus-4-8",
  max_tokens: 32000,
  thinking: { type: "adaptive" },
  output_config: {
    format: { type: "json_schema", name: "screenplay_breakdown", schema: SCREENPLAY_SCHEMA },
  },
  system: SYSTEM_PROMPT,
  messages: [{
    role: "user",
    content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
      { type: "text", text: "Extract every scene from this Thai screenplay PDF using the rules. Return JSON only." },
    ],
  }],
});

stream.on("text", () => process.stdout.write("."));
const message = await stream.finalMessage();
process.stdout.write("\n");

const ms = Date.now() - t0;
console.log(`\nDone in ${(ms/1000).toFixed(1)}s — stop_reason=${message.stop_reason}`);
console.log(`Usage: input=${message.usage.input_tokens}, output=${message.usage.output_tokens}, cache_creation=${message.usage.cache_creation_input_tokens ?? 0}, cache_read=${message.usage.cache_read_input_tokens ?? 0}`);

const textBlock = message.content.find(b => b.type === "text");
if (!textBlock) {
  console.error("No text block in response");
  process.exit(2);
}

const parsed = JSON.parse(textBlock.text);
console.log(`\nTitle:   ${parsed.title}`);
console.log(`Draft:   ${parsed.draft_date}`);
console.log(`Scenes:  ${parsed.scenes.length}\n`);

console.log("First 5 scenes:");
for (const s of parsed.scenes.slice(0, 5)) {
  console.log(`  ${s.number} ${s.type}. ${s.location} - ${s.time_of_day}`);
  console.log(`    chars: ${s.characters.join(", ")}`);
  if (s.extras.length) console.log(`    extras: ${s.extras.join(", ")}`);
}

const allExtras = parsed.scenes.filter(s => s.extras.length > 0);
console.log(`\nScenes with EXTRA: ${allExtras.length}`);
for (const s of allExtras) {
  console.log(`  ${s.number}: ${s.extras.join(", ")}`);
}

console.log("\n--- FULL JSON written to /tmp/claude-screenplay.json ---");
const fs = await import("node:fs/promises");
await fs.writeFile("/tmp/claude-screenplay.json", JSON.stringify(parsed, null, 2));
