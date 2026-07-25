import { NextResponse } from "next/server";
import simpleGit from "simple-git";

const REGION_BASE_URLS: Record<string, string> = {
  "us-south": "https://us-south.ml.cloud.ibm.com",
  "eu-de": "https://eu-de.ml.cloud.ibm.com",
  "eu-gb": "https://eu-gb.ml.cloud.ibm.com",
  "jp-tok": "https://jp-tok.ml.cloud.ibm.com",
  "ca-tor": "https://ca-tor.ml.cloud.ibm.com",
  "au-syd": "https://au-syd.ml.cloud.ibm.com",
  "br-sao": "https://br-sao.ml.cloud.ibm.com",
};

const IAM_TOKEN_URL = "https://iam.cloud.ibm.com/identity/token";
const WATSONX_API_VERSION = "2026-04-20";
const HEALTH_PROMPT = "Reply with a single word: ready";

// Models the debate engine requires. Missing ones are surfaced as warnings,
// not hard failures — the health check still confirms connectivity.
// IDs are verified against the us-south catalog; see AGENTS.md for region notes.
const REQUIRED_MODELS = [
  "ibm/granite-4-h-small",          // debate agents (SA / SRE / FinOps)
  "ibm/granite-guardian-3-8b",      // security agent
  "meta-llama/llama-3-3-70b-instruct", // synthesis step
];

export const dynamic = "force-dynamic";

export async function GET() {
  // ── 1. Validate env vars ─────────────────────────────────────────────────
  const apiKey = process.env.WATSONX_AI_APIKEY;
  const projectId = process.env.WATSONX_AI_PROJECT_ID;
  const region = process.env.WATSONX_AI_REGION ?? "us-south";

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, step: "config", error: "WATSONX_AI_APIKEY is not set" },
      { status: 500 },
    );
  }
  if (!projectId) {
    return NextResponse.json(
      { ok: false, step: "config", error: "WATSONX_AI_PROJECT_ID is not set" },
      { status: 500 },
    );
  }
  const baseURL = REGION_BASE_URLS[region];
  if (!baseURL) {
    return NextResponse.json(
      {
        ok: false,
        step: "config",
        error: `Unrecognised WATSONX_AI_REGION "${region}". Expected one of: ${Object.keys(REGION_BASE_URLS).join(", ")}`,
      },
      { status: 500 },
    );
  }

  // ── 2. Exchange API key for IAM bearer token ──────────────────────────────
  let iamToken: string;
  try {
    const iamRes = await fetch(IAM_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ibm:params:oauth:grant-type:apikey",
        apikey: apiKey,
      }),
    });

    if (!iamRes.ok) {
      const body = await iamRes.text().catch(() => "(unreadable body)");
      return NextResponse.json(
        {
          ok: false,
          step: "token_exchange",
          error: `IAM token exchange failed with HTTP ${iamRes.status}`,
          detail: body,
        },
        { status: 502 },
      );
    }

    const iamJson = (await iamRes.json()) as { access_token?: string };
    if (!iamJson.access_token) {
      return NextResponse.json(
        {
          ok: false,
          step: "token_exchange",
          error: "IAM response did not contain access_token",
        },
        { status: 502 },
      );
    }

    iamToken = iamJson.access_token;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        step: "token_exchange",
        error: "Network error reaching IAM endpoint",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${iamToken}`,
  };

  // ── 3. Discover available chat models in this region ─────────────────────
  let availableChatModels: string[] = [];
  try {
    const specsRes = await fetch(
      `${baseURL}/ml/v1/foundation_model_specs?version=${WATSONX_API_VERSION}&filters=function_text_chat&limit=200`,
      { headers: authHeaders },
    );
    if (specsRes.ok) {
      const specsJson = (await specsRes.json()) as {
        resources?: Array<{ model_id: string }>;
      };
      availableChatModels = (specsJson.resources ?? []).map((r) => r.model_id);
    }
    // Non-fatal: if discovery fails we continue and let the inference attempt
    // produce a clear error.
  } catch {
    // ignore — discovery is best-effort
  }

  // Warn about any required models missing from this region's catalog.
  const missingModels = REQUIRED_MODELS.filter(
    (m) => availableChatModels.length > 0 && !availableChatModels.includes(m),
  );

  // Pick the health-check model: prefer the first required model that exists,
  // fall back to the first available chat model, last resort use a known ID.
  const probeModel =
    REQUIRED_MODELS.find((m) => availableChatModels.includes(m)) ??
    availableChatModels[0] ??
    "ibm/granite-4-h-small";

  // ── 4. Text-generation call ───────────────────────────────────────────────
  // Raw fetch — we hold the bearer token from step 2 and inject it directly.
  // The watsonx-ai-provider SDK always re-exchanges its apiKey through IAM
  // internally, so passing a pre-fetched token to it would cause a second
  // failed exchange. Using fetch directly keeps the two failure steps cleanly
  // attributed.
  try {
    const wxRes = await fetch(
      `${baseURL}/ml/v1/text/chat?version=${WATSONX_API_VERSION}`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          model_id: probeModel,
          project_id: projectId,
          messages: [{ role: "user", content: HEALTH_PROMPT }],
          max_tokens: 20,
        }),
      },
    );

    if (!wxRes.ok) {
      const body = await wxRes.text().catch(() => "(unreadable body)");
      return NextResponse.json(
        {
          ok: false,
          step: "inference",
          model: probeModel,
          region,
          availableChatModels,
          missingRequiredModels: missingModels,
          error: `watsonx inference failed with HTTP ${wxRes.status}`,
          detail: body,
        },
        { status: 502 },
      );
    }

    const wxJson = (await wxRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const generatedText = wxJson.choices?.[0]?.message?.content ?? "";

    // ── 5. STT provider status (task 5.4) ────────────────────────────────────
    const sttProvider = process.env.STT_PROVIDER ?? "granite";
    const sttConfigured =
      sttProvider === "watson"
        ? !!(process.env.WATSON_STT_APIKEY && process.env.WATSON_STT_URL)
        : false; // granite endpoint not yet in public ml/v1 catalog

    const sttStatus = {
      provider: sttProvider,
      configured: sttConfigured,
      note: sttConfigured
        ? "Watson STT credentials present"
        : sttProvider === "watson"
        ? "Watson STT: WATSON_STT_APIKEY or WATSON_STT_URL missing"
        : "Granite Speech: endpoint not yet available in public ml/v1; set STT_PROVIDER=watson to enable",
    };

    // ── 6. simple-git status (task 5.4) ──────────────────────────────────────
    let gitStatus: { ok: boolean; latestCommit?: string; error?: string };
    try {
      const git = simpleGit(process.cwd());
      const log = await git.log({ maxCount: 1 });
      gitStatus = {
        ok: true,
        latestCommit: log.latest
          ? `${log.latest.hash.slice(0, 7)} ${log.latest.message}`
          : "(no commits)",
      };
    } catch (err) {
      gitStatus = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return NextResponse.json(
      {
        ok: true,
        region,
        baseURL,
        probeModel,
        generatedText,
        availableChatModels,
        // Non-empty means the debate engine will fail at runtime even though
        // the connectivity check itself passed.
        missingRequiredModels: missingModels,
        // Phase 5.4 additions
        stt: sttStatus,
        git: gitStatus,
      },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        step: "inference",
        model: probeModel,
        region,
        availableChatModels,
        missingRequiredModels: missingModels,
        error: "Network error reaching watsonx inference endpoint",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
