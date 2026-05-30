import { NextRequest } from "next/server";
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
            enum: ["INT", "EXT", "INT/EXT", "MONTAGE", "FLASHBACK", "DREAM", "PRESENT", "INTERCUT", "SERIES OF SHOTS"],
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

Read the attached PDF and extract EVERY scene as structured JSON.

RULES:
1. Include every numbered scene from 1 to the last. Include MONTAGE, FLASHBACK, DREAM, INTERCUT, PRESENT, "SERIES OF SHOTS" when numbered.
2. Use Thai text EXACTLY with ALL tone marks and vowels (ล่า, บ้าน, ห้อง, ผึ้ง).
3. Normalise character name spelling — one canonical form per character across all scenes.
4. Characters appear in parentheses on the line after the heading, comma-separated.
5. EXTRA entries (prefixed with "EXTRA") go in extras[], not characters[].
6. "type" must be one of: INT, EXT, INT/EXT, MONTAGE, FLASHBACK, DREAM, PRESENT, INTERCUT, SERIES OF SHOTS.
7. "location" is the FULL Thai location string (e.g., "ห้องครัวบ้านมธุสร", not "ห้องครัว").
8. "time_of_day" uppercased (DAY, NIGHT, MORNING, EVENING, ...) or "" if absent.
9. "title" = episode title from header. "draft_date" = "DD/MM/YY" from leading number (e.g., "290669" → "29/06/69"), or null.

Return ONLY the JSON object. No markdown, no commentary.`;

const USER_PROMPT =
  "Extract every scene from this Thai screenplay PDF using the rules. Return the JSON only.";

async function countPdfPages(data: ArrayBuffer): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.load(data, { ignoreEncryption: true });
  return pdf.getPageCount();
}

// NDJSON streaming response — each line is a JSON event the client consumes.
function makeStreamResponse(): {
  response: Response;
  emit: (e: unknown) => void;
  close: () => void;
} {
  const enc = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController | null = null;
  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
    },
  });
  const emit = (e: unknown) => {
    if (controllerRef) controllerRef.enqueue(enc.encode(JSON.stringify(e) + "\n"));
  };
  const close = () => controllerRef?.close();
  const response = new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
  return { response, emit, close };
}

export async function POST(request: NextRequest) {
  // 1. Auth — error returned directly (not streamed)
  const user = await getAuthedUser();
  if (!user) {
    return Response.json({ error: "Please sign in to parse." }, { status: 401 });
  }

  // 2. Read file
  let file: File;
  try {
    const formData = await request.formData();
    const f = formData.get("file");
    if (!(f instanceof File)) {
      return Response.json({ error: "No PDF uploaded." }, { status: 400 });
    }
    file = f;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `Bad request: ${msg}` }, { status: 400 });
  }
  if (file.size > 32 * 1024 * 1024) {
    return Response.json({ error: "PDF exceeds 32MB." }, { status: 413 });
  }

  // 3. Page count + credit check (non-streaming; quick)
  const buf = await file.arrayBuffer();
  let pageCount: number;
  try {
    pageCount = await countPdfPages(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `Cannot read PDF: ${msg}` }, { status: 400 });
  }
  const creditsRequired = creditsForPages(pageCount);

  const dbUser = user.isAdmin ? null : await getOrCreateUser(user.clerkId, user.email);
  if (!user.isAdmin) {
    if (!dbUser) return Response.json({ error: "User record missing." }, { status: 500 });
    if (dbUser.credits < creditsRequired) {
      return Response.json(
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

  // 4. Start streaming response — keeps connection alive past browser timeouts.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ANTHROPIC_API_KEY missing." }, { status: 500 });
  }
  const { response, emit, close } = makeStreamResponse();
  const client = new Anthropic({ apiKey });
  const base64 = Buffer.from(buf).toString("base64");

  // Run parse in the background; the stream is already attached to the response.
  (async () => {
    emit({ phase: "starting", pageCount, creditsRequired, isAdmin: user.isAdmin });
    const t0 = Date.now();

    // Heartbeat every 5s while Claude streams so the response stays alive on
    // Hobby plans and intermediaries don't buffer-close the connection.
    let lastChars = 0;
    const heartbeat = setInterval(() => {
      emit({ phase: "tick", elapsedMs: Date.now() - t0, chars: lastChars });
    }, 5000);

    try {
      const stream = client.messages.stream({
        model: "claude-haiku-4-5",
        max_tokens: 16000,
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

      stream.on("text", (delta) => {
        lastChars += delta.length;
      });

      emit({ phase: "claude_streaming" });
      const message = await stream.finalMessage();
      clearInterval(heartbeat);

      if (message.stop_reason === "refusal") {
        emit({ phase: "error", error: "Claude refused this PDF." });
        return;
      }
      if (message.stop_reason === "max_tokens") {
        emit({ phase: "error", error: "Output truncated — PDF too long." });
        return;
      }
      const textBlock = message.content.find((b): b is Extract<typeof b, { type: "text" }> => b.type === "text");
      if (!textBlock) {
        emit({ phase: "error", error: "Claude returned no text." });
        return;
      }

      let parsed: { title: string | null; draft_date: string | null; scenes: unknown[] };
      try {
        parsed = JSON.parse(textBlock.text);
      } catch {
        emit({ phase: "error", error: "Claude response was not valid JSON.", raw: textBlock.text.slice(0, 500) });
        return;
      }

      const durationMs = Date.now() - t0;

      // 5. Deduct credits + log parse (admin: log only, no deduction)
      let newBalance: number | "unlimited" = "unlimited";
      if (!user.isAdmin && dbUser) {
        try {
          newBalance = await deductCredits(dbUser.id, creditsRequired);
        } catch (e) {
          console.error("Credit deduction failed after parse:", e);
        }
        const db = supabaseAdmin();
        await db.from("parses").insert({
          user_id: dbUser.id,
          pdf_name: file.name,
          page_count: pageCount,
          credits_used: creditsRequired,
          scenes_count: parsed.scenes.length,
          status: "succeeded",
          input_tokens: message.usage.input_tokens,
          output_tokens: message.usage.output_tokens,
          duration_ms: durationMs,
        });
      }

      emit({
        phase: "done",
        result: {
          title: parsed.title,
          draft_date: parsed.draft_date,
          scenes: parsed.scenes,
          meta: {
            pageCount,
            creditsUsed: user.isAdmin ? 0 : creditsRequired,
            creditsRemaining: newBalance,
            isAdmin: user.isAdmin,
            durationMs,
          },
        },
      });
    } catch (error) {
      clearInterval(heartbeat);
      if (error instanceof Anthropic.RateLimitError) {
        emit({ phase: "error", error: "Rate limited — retry shortly." });
      } else if (error instanceof Anthropic.APIError) {
        emit({ phase: "error", error: `Claude API error: ${error.message}` });
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        emit({ phase: "error", error: msg });
      }
    } finally {
      close();
    }
  })();

  return response;
}
