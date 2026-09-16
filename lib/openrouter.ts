/**
 * OpenRouter client. The API key never leaves the server.
 *
 * SPEED IS THE FEATURE. A student who is stuck does not wait thirty seconds.
 * Three things in here are what make it quick:
 *
 * 1. Fast paid models lead every chain. The free tier is where the old latency
 *    came from: free models are rate-limited, queued behind everyone else's
 *    traffic, and mostly REASONING models that burn their token budget thinking
 *    before they say anything. The paid "flash" tier answers in ~1-3s instead
 *    of ~10-30s, and a whole tutoring session costs a fraction of a cent.
 *
 * 2. Free models stay on as the last links in the chain. If the OpenRouter
 *    account runs dry the paid models return 402, which is retryable, and the
 *    app degrades to exactly its old behaviour rather than breaking.
 *
 * 3. Replies stream. Time-to-first-word is what "fast" actually feels like, and
 *    a streamed reply starts in well under a second even when the full answer
 *    takes several.
 */

/**
 * Any OpenAI-compatible chat-completions endpoint works, not just OpenRouter.
 *
 * NVIDIA NIM (`https://integrate.api.nvidia.com/v1`) is the other one this is
 * known to run against, and the same override lets the streaming path be
 * exercised against a local mock.
 */
const BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const API = BASE + "/chat/completions";

/**
 * OpenRouter takes two parameters nobody else does: a `reasoning` object, and
 * attribution headers. Sending `reasoning` to NVIDIA NIM is rejected outright
 * rather than ignored, so it has to be conditional — this is the single thing
 * that stops the client being provider-agnostic on its own.
 */
const IS_OPENROUTER = BASE.includes("openrouter.ai");

/** The key, whichever provider is configured. */
function apiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || process.env.NVIDIA_API_KEY;
}

/**
 * Vercel caps a serverless function at 60s, and a killed function returns the
 * platform's error page rather than ours. Keep the entire fallback chain inside
 * that, leaving headroom for the response to be written.
 */
const TOTAL_BUDGET_MS = 50_000;

/**
 * How long one model gets to say its FIRST word. Paid flash models answer in
 * about a second, so anything past this is a model that is struggling and the
 * chain is better off moving on. Once a stream has started it is not cut off
 * here — only the total budget bounds it.
 */
const FIRST_TOKEN_MS = 9_000;

/** A non-streamed call has to finish, not just start, inside this. */
const PER_MODEL_MS = 20_000;

const MIN_ATTEMPT_MS = 4_000;

/**
 * One budget for the whole HTTP request, not one per model call.
 *
 * Letting each call start its own 50s budget allows more than 60s inside a 60s
 * function: the platform kills it mid-flight and serves its own error page, so
 * the friendly JSON below never reaches the browser. A route that makes more
 * than one call creates a deadline once and passes it to each.
 */
export function newDeadline(): number {
  return Date.now() + TOTAL_BUDGET_MS;
}

/**
 * Paid models, cheapest-and-fastest first. All three read images as well as
 * text, so scanning a photo and talking about it use the same chain.
 *
 * Rough cost of one tutoring turn at the top of this chain: about $0.0005.
 * A hundred turns is five cents.
 */
const FAST_PAID = [
  // Google's flash-lite tier. Quickest good answer available, and the best of
  // the cheap models at reading handwriting and equations off a photo.
  "google/gemini-3.1-flash-lite",
  // Different provider, so a Google outage does not take the app down.
  "openai/gpt-5-mini",
  // Cheapest of the three by a wide margin; a fine tutor and very quick.
  "qwen/qwen3.7-flash",
];

/**
 * Free models, kept as the tail of every chain. These are what the app ran on
 * before and they still work — they are just slow. Reaching these means either
 * the account is out of credit (402) or all three paid models are down.
 *
 * `openrouter/free` sits LAST on purpose: it is a meta-router that picks any
 * free model, including domain-specific ones (…-sante is health, …-fin is
 * finance) that are wrong for tutoring and have been observed returning empty
 * content.
 */
const FREE_TEXT = [
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
];

const FREE_VISION = [
  "inclusionai/ling-3.0-flash-vl:free",
  "google/gemma-4-31b-it:free",
  "nex-agi/nex-n2.5-pro:free",
  "openrouter/free",
];

const DEFAULT_TEXT = [...FAST_PAID, ...FREE_TEXT];
const DEFAULT_VISION = [...FAST_PAID, ...FREE_VISION];

function chain(envVar: string, fallback: string[]): string[] {
  const raw = process.env[envVar];
  if (!raw) return fallback;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

/**
 * Which models a chain would use, for the health check to report.
 *
 * The built-in chains are OpenRouter model IDs. Point the client at another
 * provider and those IDs mean nothing there, so a chain MUST be configured —
 * falling back would just 404 four times and report "every model is busy",
 * which sends you looking in the wrong place entirely.
 */
export function modelChain(vision: boolean): string[] {
  const configured = vision
    ? chain("OPENROUTER_VISION_MODELS", [])
    : chain("OPENROUTER_TEXT_MODELS", []);

  if (configured.length) return configured;
  if (!IS_OPENROUTER) return [];
  return vision ? DEFAULT_VISION : DEFAULT_TEXT;
}

/** Thrown when a non-OpenRouter provider is configured with no model chain. */
function noModels(vision: boolean): TutorError {
  return new TutorError(
    `No models configured for ${BASE}. Set ` +
      `${vision ? "OPENROUTER_VISION_MODELS" : "OPENROUTER_TEXT_MODELS"} ` +
      `to a comma-separated list of model IDs that provider actually hosts. ` +
      `The built-in defaults are OpenRouter IDs and do not exist elsewhere.`,
    500,
  );
}

export type TextPart = { type: "text"; text: string };
export type ImagePart = { type: "image_url"; image_url: { url: string } };
export type Content = string | (TextPart | ImagePart)[];
export type Msg = { role: "system" | "user" | "assistant"; content: Content };

export class TutorError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** True when a failure is worth retrying on the next model in the chain. */
function retryable(status: number): boolean {
  // 429 rate limited, 402 credits gone (this is the paid -> free handoff),
  // 404 model retired, 403 provider refused, 400 model rejected the payload
  // (e.g. no image support), 5xx upstream. A bad API key surfaces as 401,
  // which retrying will not fix.
  return (
    status === 429 || status === 402 || status === 404 ||
    status === 403 || status === 400 || status >= 500
  );
}

type Choice = {
  message?: { content?: string | null; reasoning?: string | null };
  finish_reason?: string;
};

/**
 * Pull the usable answer out of a reply. Reasoning models sometimes put
 * everything in `reasoning`; rather than failing, salvage the tail of it.
 */
function extract(choice: Choice | undefined): string {
  const content = choice?.message?.content?.trim();
  if (content) return content;

  const reasoning = choice?.message?.reasoning?.trim();
  if (reasoning && choice?.finish_reason !== "length") {
    // Take the last paragraph — that is where such models land their answer.
    const parts = reasoning.split(/\n\s*\n/).filter((p) => p.trim());
    return (parts[parts.length - 1] ?? reasoning).trim();
  }

  return "";
}

type CallOpts = {
  maxTokens: number;
  temperature: number;
  json: boolean;
  stream?: boolean;
  signal?: AbortSignal;
};

function requestBody(model: string, messages: Msg[], opts: CallOpts) {
  return JSON.stringify({
    model,
    messages,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    // Keep thinking short and out of the response; brevity is enforced by
    // the prompts, not by starving the model of tokens. On the paid flash
    // models this is also the difference between a 1s and an 8s reply.
    // OpenRouter-only: other providers reject the field rather than ignore it.
    ...(IS_OPENROUTER ? { reasoning: { effort: "low", exclude: true } } : {}),
    ...(opts.stream ? { stream: true } : {}),
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
  });
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
    // Attribution, and OpenRouter-only.
    ...(IS_OPENROUTER
      ? {
          "HTTP-Referer":
            process.env.NEXT_PUBLIC_SITE_URL || "https://mintai-three.vercel.app",
          "X-Title": "Tutor Mint",
        }
      : {}),
  };
}

async function callModel(model: string, messages: Msg[], opts: CallOpts): Promise<string> {
  const res = await fetch(API, {
    method: "POST",
    headers: headers(),
    body: requestBody(model, messages, opts),
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TutorError(`${model}: ${res.status} ${body.slice(0, 180)}`, res.status);
  }

  const data = await res.json();

  // OpenRouter can return HTTP 200 with an error body when a provider fails.
  if (data?.error) {
    const status = Number(data.error.code) || 502;
    throw new TutorError(`${model}: ${data.error.message ?? "upstream error"}`, status);
  }

  const text = extract(data?.choices?.[0]);
  if (!text) {
    // Ran out of budget mid-thought, or returned nothing usable — next model.
    throw new TutorError(`${model}: no usable reply`, 502);
  }
  return text;
}

export async function complete(
  messages: Msg[],
  opts: {
    vision?: boolean;
    maxTokens?: number;
    temperature?: number;
    json?: boolean;
    /** Shared with the rest of the request when there is more than one call. */
    deadline?: number;
  } = {},
): Promise<{ text: string; model: string }> {
  if (!apiKey()) {
    throw new TutorError(
      "No model API key is set on the server (OPENROUTER_API_KEY or NVIDIA_API_KEY).",
      500,
    );
  }

  const models = modelChain(Boolean(opts.vision));
  if (!models.length) throw noModels(Boolean(opts.vision));

  const settings = {
    maxTokens: opts.maxTokens ?? 1600,
    temperature: opts.temperature ?? 0.55,
    json: opts.json ?? false,
  };

  const deadline = opts.deadline ?? newDeadline();
  let last: TutorError | null = null;
  let tried = 0;
  let outOfTime = false;

  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) {
      outOfTime = true;
      break;
    }
    tried++;

    const timer = AbortSignal.timeout(Math.min(PER_MODEL_MS, remaining));
    try {
      const text = await callModel(model, messages, { ...settings, signal: timer });
      return { text, model };
    } catch (err) {
      const e =
        err instanceof TutorError
          ? err
          : new TutorError(`${model}: ${(err as Error).message}`, 502);
      last = e;
      if (!retryable(e.status)) throw e;
      // else: try the next model in the chain
    }
  }

  throw new TutorError(exhausted(tried, models.length, outOfTime, last), 503);
}

/**
 * The same fallback chain, but yielding text as it arrives.
 *
 * A model only "counts" as working once it produces a first token, so a model
 * that accepts the connection and then stalls still falls through to the next
 * one. Once text has started flowing we are committed: failing over mid-answer
 * would mean showing the student two different half-answers.
 */
export async function* stream(
  messages: Msg[],
  opts: {
    vision?: boolean;
    maxTokens?: number;
    temperature?: number;
    deadline?: number;
    /**
     * Fires with the model that actually answered, the moment it does.
     *
     * Worth having: without it a reply that quietly fell through to the slow
     * free tail is indistinguishable from one served by the fast paid model at
     * the top, and the only symptom is that the app "feels slow again".
     */
    onModel?: (model: string) => void;
  } = {},
): AsyncGenerator<string, void, unknown> {
  if (!apiKey()) {
    throw new TutorError(
      "No model API key is set on the server (OPENROUTER_API_KEY or NVIDIA_API_KEY).",
      500,
    );
  }

  const models = modelChain(Boolean(opts.vision));
  if (!models.length) throw noModels(Boolean(opts.vision));

  const settings = {
    maxTokens: opts.maxTokens ?? 1600,
    temperature: opts.temperature ?? 0.55,
    json: false,
    stream: true,
  };

  const deadline = opts.deadline ?? newDeadline();
  let last: TutorError | null = null;
  let tried = 0;
  let outOfTime = false;

  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) {
      outOfTime = true;
      break;
    }
    tried++;

    // Two clocks: this one gives up if no first token arrives, and is cleared
    // the moment one does. After that the stream runs to its natural end.
    const control = new AbortController();
    const firstToken = setTimeout(
      () => control.abort(),
      Math.min(FIRST_TOKEN_MS, remaining),
    );
    let started = false;

    try {
      const res = await fetch(API, {
        method: "POST",
        headers: headers(),
        body: requestBody(model, messages, settings),
        signal: control.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new TutorError(`${model}: ${res.status} ${body.slice(0, 180)}`, res.status);
      }
      if (!res.body) throw new TutorError(`${model}: empty stream`, 502);

      for await (const delta of readSse(res.body)) {
        if (!started) {
          started = true;
          clearTimeout(firstToken);
          opts.onModel?.(model);
        }
        yield delta;
      }

      if (!started) throw new TutorError(`${model}: no usable reply`, 502);
      return;
    } catch (err) {
      clearTimeout(firstToken);

      // Past the first token there is no going back — the student is already
      // reading the answer. Surface the break rather than starting a new one.
      if (started) throw err;

      const e =
        err instanceof TutorError
          ? err
          : new TutorError(`${model}: ${(err as Error).message}`, 502);
      last = e;
      if (!retryable(e.status)) throw e;
    } finally {
      clearTimeout(firstToken);
    }
  }

  throw new TutorError(exhausted(tried, models.length, outOfTime, last), 503);
}

/** Say which of the two actually happened — they point at different problems. */
function exhausted(
  tried: number,
  total: number,
  outOfTime: boolean,
  last: TutorError | null,
): string {
  const detail = last?.message ?? "no models available";
  return outOfTime
    ? `That took too long — ${tried} of ${total} models were tried before time ran out. Try again. (${detail})`
    : `Couldn't get a tutor model to answer. Give it a minute and try again. (${detail})`;
}

/** Turn OpenRouter's SSE body into a stream of content deltas. */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line, but OpenRouter also sends
      // ": OPENROUTER PROCESSING" comment lines as keep-alives. Splitting on
      // newlines and skipping anything that is not a `data:` payload handles
      // both without a parser.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let parsed: {
          choices?: { delta?: { content?: string | null } }[];
          error?: { message?: string; code?: unknown };
        };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue; // a partial frame; the next chunk completes it
        }

        if (parsed.error) {
          const status = Number(parsed.error.code) || 502;
          throw new TutorError(parsed.error.message ?? "upstream error", status);
        }

        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Pull the first JSON object/array out of a model reply. */
export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (!match) throw new TutorError("Could not read the model's reply.", 502);
    return JSON.parse(match[0]) as T;
  }
}
