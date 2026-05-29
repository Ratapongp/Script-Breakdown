import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
// 5 min — Claude PDF reads on a 44-page screenplay typically take 30–90s.
// Vercel Pro plan or higher is required for maxDuration > 60s.
export const maxDuration = 300;

// JSON schema fed to Claude's structured-output mode (output_config.format).
// Keep this aligned with lib/scenes.ts ScreenplayDoc.
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
            enum: [
              "INT",
              "EXT",
              "INT/EXT",
              "MONTAGE",
              "FLASHBACK",
              "DREAM",
              "PRESENT",
              "INTERCUT",
              "SERIES OF SHOTS",
            ],
          },
          location: { type: "string" },
          time_of_day: { type: "string" },
          characters: { type: "array", items: { type: "string" } },
          extras: { type: "array", items: { type: "string" } },
        },
        required: [
          "number",
          "type",
          "location",
          "time_of_day",
          "characters",
          "extras",
        ],
      },
    },
  },
  required: ["title", "draft_date", "scenes"],
};

const SYSTEM_PROMPT = `You are an expert script supervisor and screenplay breakdown analyst specialising in Thai screenplays.

Your job: read the attached PDF and extract EVERY scene as structured JSON.

RULES — read carefully:

1. SCOPE
   - Include every numbered scene from scene 1 to the last numbered scene. Do not skip any.
   - Include MONTAGE, FLASHBACK, DREAM, INTERCUT, PRESENT, and "SERIES OF SHOTS" sequences when they are numbered as scenes — they count.

2. TEXT FIDELITY
   - Use Thai text EXACTLY as it appears in the PDF, with ALL tone marks and vowels (ล่า not ลา, ห้อง not หอง, ผึ้ง not ผง).
   - Do NOT transliterate, romanise, translate, or "correct" Thai spellings.

3. CHARACTER NAME NORMALISATION
   - Within a single screenplay, a character must appear with ONE consistent spelling across all scenes.
   - If you see the same character written as "ผึ้ง" in some scenes and "ผึง" in others, pick the most common / correct form and use it everywhere.
   - Do NOT split one character into two entries because of inconsistent typing.

4. CHARACTER LIST FORMAT
   - The characters appearing in a scene are listed in parentheses on the line immediately after the scene heading, comma-separated.
   - Example: (มธุสร, ผึ้ง, เสกสรร)
   - Put these in the "characters" array, trimmed, in the order they appear.

5. EXTRA CAST
   - EXTRA entries appear inside the same parentheses, prefixed with the word "EXTRA" (uppercase).
   - Example: (มธุสร, ผึ้ง, EXTRA ครู-นักเรียน) — characters = ["มธุสร", "ผึ้ง"], extras = ["ครู-นักเรียน"]
   - Take what follows "EXTRA" as the description (trim leading colon, dash, or space).
   - Do NOT invent or estimate quantities; only extract descriptions written in the screenplay.

6. SCENE HEADING SHAPE
   - Standard: "<number> INT.<location> - <time>" or "<number> EXT.<location> - <time>"
   - Combined: "<number> INT/EXT.<location> - <time>"
   - MONTAGE-style: "<number> MONTAGE - <description>" (time may be absent — use empty string)
   - The "type" field must be one of: INT, EXT, INT/EXT, MONTAGE, FLASHBACK, DREAM, PRESENT, INTERCUT, SERIES OF SHOTS.

7. LOCATION
   - Include the FULL Thai location string as written (e.g., "ห้องครัวบ้านมธุสร", not just "ห้องครัว"; "ห้องประชุมโรงเรียนกัลยาณีวิทย์", not just "ห้องประชุม").
   - Do not abbreviate or shorten.

8. TIME OF DAY
   - Use the exact word from the screenplay, uppercased: DAY, NIGHT, MORNING, EVENING, DUSK, DAWN, LATER, CONTINUOUS, etc.
   - If absent (e.g., for MONTAGE), use empty string "".

9. TITLE & DRAFT DATE
   - The header at the top of every page typically reads like "290669 Screenplay ล่า EP.1 | 1".
   - "title" = the episode title (e.g., "ล่า EP.1") — clean, no page number, with tone marks.
   - "draft_date" = the leading 6- or 8-digit number formatted as DD/MM/YY or DD/MM/YYYY (e.g., "290669" → "29/06/69"). Use null if no draft date is present.

OUTPUT:
Return ONLY the JSON object matching the schema. No markdown fences, no commentary, no "here is the JSON". Just the JSON.`;

const USER_PROMPT =
  "Extract every scene from this Thai screenplay PDF using the rules in the system prompt. Return the structured JSON only.";

interface ClaudeScene {
  number: number;
  type: string;
  location: string;
  time_of_day: string;
  characters: string[];
  extras: string[];
}
interface ClaudeOutput {
  title: string | null;
  draft_date: string | null;
  scenes: ClaudeScene[];
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Server is missing ANTHROPIC_API_KEY. Set it in .env.local (dev) or your Vercel project's environment variables.",
      },
      { status: 500 },
    );
  }

  let file: File;
  try {
    const formData = await request.formData();
    const f = formData.get("file");
    if (!(f instanceof File)) {
      return NextResponse.json({ error: "No PDF uploaded under 'file' field." }, { status: 400 });
    }
    file = f;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Bad request: ${msg}` }, { status: 400 });
  }

  if (file.size > 32 * 1024 * 1024) {
    return NextResponse.json(
      { error: "PDF exceeds 32MB. Compress it before uploading." },
      { status: 413 },
    );
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const client = new Anthropic({ apiKey });

  try {
    // Streaming is required because long responses can blow past the SDK's
    // ~10 minute HTTP timeout (SDK refuses non-streaming for big max_tokens).
    const stream = client.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: {
        format: {
          type: "json_schema",
          name: "screenplay_breakdown",
          schema: SCREENPLAY_SCHEMA,
        },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            { type: "text", text: USER_PROMPT },
          ],
        },
      ],
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      return NextResponse.json(
        {
          error: "Claude refused to process this PDF.",
          stop_details: message.stop_details,
        },
        { status: 422 },
      );
    }
    if (message.stop_reason === "max_tokens") {
      return NextResponse.json(
        { error: "Output truncated at max_tokens. PDF may be unusually long — split and retry." },
        { status: 500 },
      );
    }

    const textBlock = message.content.find(
      (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
    );
    if (!textBlock) {
      return NextResponse.json(
        { error: "Claude returned no text block.", stop_reason: message.stop_reason },
        { status: 500 },
      );
    }

    let parsed: ClaudeOutput;
    try {
      parsed = JSON.parse(textBlock.text) as ClaudeOutput;
    } catch {
      return NextResponse.json(
        {
          error: "Claude response was not valid JSON.",
          raw: textBlock.text.slice(0, 2000),
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      title: parsed.title,
      draft_date: parsed.draft_date,
      scenes: parsed.scenes,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        cache_creation_input_tokens: message.usage.cache_creation_input_tokens,
        cache_read_input_tokens: message.usage.cache_read_input_tokens,
      },
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Rate limited by Anthropic API. Retry in a moment." },
        { status: 429 },
      );
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is invalid. Check your Anthropic console." },
        { status: 401 },
      );
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Anthropic API error: ${error.message}` },
        { status: error.status ?? 500 },
      );
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Claude parse error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
