"use client";

/**
 * One way to call our API routes.
 *
 * The important part is that a response is not always JSON. If a serverless
 * function times out, runs out of memory, or the deploy is missing, the
 * platform returns its own HTML error page — and calling res.json() on that
 * throws "Unexpected token '<'", which tells the student nothing. Everything
 * that comes out of here is a sentence a person can act on.
 */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;

  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }

  const raw = await res.text();

  let data: { error?: string } | null = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    // Not JSON — the platform answered instead of our route.
    throw new Error(platformError(res.status, res.ok));
  }

  if (!res.ok) throw new Error(data?.error ?? `Something went wrong (${res.status}).`);
  if (!data) throw new Error("The server sent back nothing. Tap Retry.");

  return data as T;
}

function platformError(status: number, ok: boolean): string {
  if (status === 504 || status === 408) return "That took too long. Tap Retry.";
  if (status === 413) return "That photo is too big. Try again with a tighter crop.";
  return ok
    ? "Got an unreadable reply from the server. Tap Retry."
    : `The server hit an error (${status}). Tap Retry.`;
}

/** What the tutor route sends down the wire, one JSON object per line. */
export type TutorEvent =
  | { t: "model"; model: string }
  | { t: "problem"; subject: string; problem: string }
  | { t: "d"; v: string }
  | { t: "error"; error: string }
  | { t: "done" };

/**
 * Call a streaming route and yield its events as they land.
 *
 * Anything that fails before the first byte still arrives as an ordinary JSON
 * error with a real status code, so the caller gets the same readable sentence
 * it would have got from postJson.
 */
export async function* postStream(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<TutorEvent, void, unknown> {
  let res: Response;

  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
    throw new Error("Can't reach the server. Check your connection and try again.");
  }

  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");

    let data: { error?: string } | null = null;
    try {
      data = raw ? (JSON.parse(raw) as { error?: string }) : null;
    } catch {
      // Not JSON — the platform answered instead of our route.
      throw new Error(platformError(res.status, res.ok));
    }

    throw new Error(data?.error ?? `Something went wrong (${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line) as TutorEvent;
        } catch {
          // A torn line; the next chunk completes it.
        }
      }
    }

    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer) as TutorEvent;
      } catch {
        /* nothing usable in the tail */
      }
    }
  } finally {
    reader.releaseLock();
  }
}
