import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthedUser } from "@/lib/auth-helpers";
import { getOrCreateUser, supabaseAdmin, deductCredits } from "@/lib/supabase";
import { creditsForPages, PAGES_PER_CREDIT } from "@/lib/pricing";

export const runtime = "nodejs";
export const maxDuration = 300;

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
        required: ["number", "type", "location", "time_of_day", "characters", "extras"],
      },
    },
  },
  required: ["title", "draft_date", "scenes"],
};

const SYSTEM_PROMPT = `You are an expert script supervisor and screenplay breakdown analyst specialising in Thai screenplays.

Your job: read the attached PDF and extract EVERY scene as structured JSON.

RULES:
1. Include every numbered scene from 1 to the last. Do not skip any.
2. Include MONTAGE, FLASHBACK, DREAM, INTERCUT, PRESENT, and "SERIES OF SHOTS" sequences when they are numbered as scenes.
3. Use Thai text EXACTLY with ALL tone marks and vowels (ล่า not ลา, ห้อง not หอง, ผึ้ง not ผง).
4. Normalise character name spelling — pick one canonical form per character across all scenes.
5. The characters appearing in the scene are in parentheses on the line after the heading, comma-separated.
6. EXTRA entries (prefixed with "EXTRA") go in extras[], not characters[].
7. "type" must be one of: INT, EXT, INT/EXT, MONTAGE, FLASHBACK, DREAM, PRESENT, INTERCUT, SERIES OF SHOTS.
8. "location" is the FULL Thai location string (e.g., "ห้องครัวบ้านมธุสร", not "ห้องครัว").
9. "time_of_day" uppercased (DAY, NIGHT, MORNING, EVENING, DUSK, DAWN, LATER, CONTINUOUS) or "" if absent.
10. "title" = episode title from header. "draft_date" = "DD/MM/YY" from leading number (e.g., "290669" → "29/06/69"), or null.

Return ONLY the JSON object. No markdown, no commentary.`;

const USER_PROMPT =
  "Extract every scene from this Thai screenplay PDF using the rules. Return the JSON only.";

// Count pages from a PDF buffer using pdf.js (node-friendly legacy build).
async function countPdfPages(data: ArrayBuffer): Promise<number> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
  return pdf.numPages;
}

export async function POST(request: NextRequest) {
  // 1. Auth
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Please sign in to parse." }, { status: 401 });

  // 2. Read file
  let file: File;
  try {
    const formData = await request.formData();
    const f = formData.get("file");
    if (!(f instanceof File)) {
      return NextResponse.json({ error: "No PDF uploaded." }, { status: 400 });
    }
    file = f;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Bad request: ${msg}` }, { status: 400 });
  }
  if (file.size > 32 * 1024 * 1024) {
    return NextResponse.json({ error: "PDF exceeds 32MB." }, { status: 413 });
  }

  // 3. Pre-flight: count pages → credits required
  const buf = await file.arrayBuffer();
  const pageCount = await countPdfPages(buf);
  const creditsRequired = creditsForPages(pageCount);

  // 4. Credit check (admins bypass)
  const dbUser = user.isAdmin ? null : await getOrCreateUser(user.clerkId, user.email);
  if (!user.isAdmin) {
    if (!dbUser) return NextResponse.json({ error: "User record missing." }, { status: 500 });
    if (dbUser.credits < creditsRequired) {
      return NextResponse.json(
        {
          error: "Not enough credits.",
          required: creditsRequired,
          balance: dbUser.credits,
          pageCount,
          pagesPerCredit: PAGES_PER_CREDIT,
        },
        { status: 402 },
      );
    }
  }

  // 5. Parse with Claude
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY missing." }, { status: 500 });
  }
  const client = new Anthropic({ apiKey });
  const base64 = Buffer.from(buf).toString("base64");
  const t0 = Date.now();

  let parsed: { title: string | null; draft_date: string | null; scenes: unknown[] };
  let usage: { input_tokens: number; output_tokens: number };

  try {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: {
        format: { type: "json_schema", schema: SCREENPLAY_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
            { type: "text", text: USER_PROMPT },
          ],
        },
      ],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      return NextResponse.json({ error: "Claude refused this PDF." }, { status: 422 });
    }
    if (message.stop_reason === "max_tokens") {
      return NextResponse.json({ error: "Output truncated — PDF too long." }, { status: 500 });
    }
    const textBlock = message.content.find((b): b is Extract<typeof b, { type: "text" }> => b.type === "text");
    if (!textBlock) {
      return NextResponse.json({ error: "Claude returned no text." }, { status: 500 });
    }
    parsed = JSON.parse(textBlock.text);
    usage = { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Rate limited — retry shortly." }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Claude API error: ${error.message}` }, { status: error.status ?? 500 });
    }
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const durationMs = Date.now() - t0;

  // 6. Deduct credits + log parse (admin: log only, no deduction)
  let newBalance: number | null = null;
  if (!user.isAdmin && dbUser) {
    try {
      newBalance = await deductCredits(dbUser.id, creditsRequired);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Race: someone else used credits; surface but don't fail the parse already done.
      console.error("Credit deduction failed after parse:", msg);
    }
    const db = supabaseAdmin();
    await db.from("parses").insert({
      user_id: dbUser.id,
      pdf_name: file.name,
      page_count: pageCount,
      credits_used: creditsRequired,
      scenes_count: parsed.scenes.length,
      status: "succeeded",
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      duration_ms: durationMs,
    });
  }

  return NextResponse.json({
    title: parsed.title,
    draft_date: parsed.draft_date,
    scenes: parsed.scenes,
    meta: {
      pageCount,
      creditsUsed: user.isAdmin ? 0 : creditsRequired,
      creditsRemaining: user.isAdmin ? "unlimited" : newBalance,
      isAdmin: user.isAdmin,
      durationMs,
    },
  });
}
