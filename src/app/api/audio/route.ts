/**
 * app/api/audio/route.ts
 * TASKS.md 4.6 — Audio upload → transcript.
 *
 * POST multipart/form-data with a `file` field (audio/mpeg, .mp3).
 * Returns: { transcript: string, transcription_unavailable?: boolean }
 *
 * Dev shortcut: POST JSON { "text": "..." } to inject a transcript directly
 * without uploading audio. Useful for testing the diagram-update pipeline
 * when Watson STT credentials are not configured.
 *
 * Provider selection (AGENTS.md: granite-speech-4.1-2b primary, watson-stt fallback):
 *   STT_PROVIDER=watson  → Watson Speech-to-Text REST API
 *                          requires WATSON_STT_APIKEY + WATSON_STT_URL
 *   STT_PROVIDER=granite → watsonx ml/v1/speech (not yet in public REST catalog)
 *                          falls through to stub with transcription_unavailable flag
 *   (default/missing)   → try Watson STT if creds present, else stub
 *
 * Task 5.3 fallback: if every provider call fails, return
 *   { transcript: "", transcription_unavailable: true }
 * so the UI can display gracefully without a hard error.
 */
import { NextResponse } from "next/server";

// ── Watson STT ────────────────────────────────────────────────────────────────

const WATSON_STT_MODEL = "en-US_BroadbandModel";

async function transcribeWithWatson(
  audioBuffer: Buffer,
  contentType: string
): Promise<string> {
  const sttUrl = process.env.WATSON_STT_URL;
  const sttKey = process.env.WATSON_STT_APIKEY;

  if (!sttUrl || !sttKey) {
    throw new Error("WATSON_STT_URL or WATSON_STT_APIKEY not configured");
  }

  // Watson STT basic-auth uses apikey as the password, "apikey" as the user
  const credentials = Buffer.from(`apikey:${sttKey}`).toString("base64");
  const endpoint = `${sttUrl.replace(/\/$/, "")}/v1/recognize?model=${WATSON_STT_MODEL}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": contentType,
    },
    body: new Uint8Array(audioBuffer),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`Watson STT HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    results?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
  };

  const transcript = (json.results ?? [])
    .flatMap((r) => r.alternatives ?? [])
    .map((a) => a.transcript ?? "")
    .join(" ")
    .trim();

  return transcript;
}

// ── Granite Speech stub ───────────────────────────────────────────────────────
// granite-speech-4.1-2b is not yet available via the standard watsonx ml/v1
// REST API for multipart audio. When the endpoint is available it would follow
// the pattern below. Until then we return transcription_unavailable.

async function transcribeWithGranite(): Promise<never> {
  throw new Error(
    "granite-speech-4.1-2b audio transcription endpoint not available in ml/v1 REST API. " +
      "Set STT_PROVIDER=watson and supply WATSON_STT_APIKEY + WATSON_STT_URL to enable transcription."
  );
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  // ── Dev shortcut: JSON body with { text } bypasses audio upload entirely ──
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await request.json().catch(() => null) as { text?: string } | null;
    if (body?.text && typeof body.text === "string" && body.text.trim().length > 0) {
      console.log(`[audio] dev text-inject mode, length=${body.text.length}`);
      return NextResponse.json({ transcript: body.text.trim() });
    }
    return NextResponse.json(
      { error: "JSON body must include a non-empty `text` field." },
      { status: 400 }
    );
  }

  // ── Normal multipart upload path ──────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data request with a `file` field." },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "`file` field is missing or is not a file." },
      { status: 400 }
    );
  }

  // Accept audio/mpeg, audio/mp3, audio/wav, audio/ogg — Watson handles all
  const contentType = file.type || "audio/mpeg";
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);

  const provider = process.env.STT_PROVIDER ?? "granite";
  console.log(`[audio] provider=${provider} size=${audioBuffer.length} type=${contentType}`);

  // ── Provider dispatch with 5.3 fallback ────────────────────────────────────
  try {
    let transcript: string;

    if (provider === "watson") {
      transcript = await transcribeWithWatson(audioBuffer, contentType);
    } else {
      // granite or default — stub until endpoint is published
      transcript = await transcribeWithGranite();
    }

    if (!transcript) {
      // Empty transcript from a valid response — still counts as success
      return NextResponse.json({ transcript: "", transcription_unavailable: false });
    }

    return NextResponse.json({ transcript });
  } catch (err) {
    // Task 5.3: graceful fallback — never hard-error the UI
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[audio] transcription failed: ${message}`);

    return NextResponse.json(
      {
        transcript: "",
        transcription_unavailable: true,
        reason: message,
      },
      { status: 200 } // 200 so the UI handles it gracefully rather than an error branch
    );
  }
}
