import { NextResponse } from "next/server";
import { complete, stream, newDeadline, TutorError, type Msg } from "@/lib/openrouter";
import {
  GUIDE_SYSTEM,
  EXPLAIN_SYSTEM,
  scanSystem,
  voiceSystem,
} from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  messages: { role: "user" | "assistant"; content: string }[];
  mode?: "guide" | "explain";
  image?: string | null;   // data URL, only on the first turn of a scan
  voice?: boolean;
  /** Streamed replies are the default; Voice asks for the whole thing at once. */
  stream?: boolean;
};

/**
 * A scanned photo comes back as "SUBJECT: … PROBLEM: … --- <reply>". Find the
 * separator and split there.
 *
 * Returns null while the header might still be arriving, so the caller knows to
 * keep buffering rather than to give up.
 */
function splitHeader(raw: string): { subject: string; problem: string; rest: string } | null {
  const match = raw.match(/^([\s\S]*?)\n\s*-{3,}\s*\n([\s\S]*)$/);
  if (!match) return null;

  const [, head, rest] = match;
  return {
    subject: head.match(/SUBJECT:\s*(.+)/i)?.[1]?.trim() ?? "",
    problem: head.match(/PROBLEM:\s*([\s\S]+?)\s*$/i)?.[1]?.trim() ?? head.trim(),
    rest,
  };
}

/**
 * How much of a scan reply to buffer while waiting for the `---` separator.
 * A model that ignores the format would otherwise hold the whole answer back;
 * past this we give up on the header and show everything as the reply.
 */
const HEADER_LIMIT = 2_000;

const enc = new TextEncoder();
const event = (obj: unknown) => enc.encode(JSON.stringify(obj) + "\n");

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const mode = body.mode === "explain" ? "explain" : "guide";
  const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const hasImage = Boolean(body.image);
  const wantsStream = body.stream !== false && !body.voice;

  const deadline = newDeadline();

  // Build the turns. A photo is now ONE call: the vision model reads the page
  // and tutors from it in the same reply. It used to be two calls in series —
  // read, then tutor — which meant waiting out two models before seeing a word.
  const turns: Msg[] = [];

  if (body.image) {
    turns.push({
      role: "user",
      content: [
        { type: "text", text: "Here is my work. I'm stuck." },
        { type: "image_url", image_url: { url: body.image } },
      ],
    });
  }

  for (const m of history) {
    if (typeof m?.content === "string" && m.content.trim()) {
      turns.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
    }
  }

  if (!turns.length) {
    return NextResponse.json({ error: "Nothing to work on yet." }, { status: 400 });
  }

  const system = body.voice
    ? voiceSystem(mode)
    : hasImage
      ? scanSystem(mode)
      : mode === "explain"
        ? EXPLAIN_SYSTEM
        : GUIDE_SYSTEM;

  const messages: Msg[] = [{ role: "system", content: system }, ...turns];
  const maxTokens = body.voice ? 1200 : mode === "explain" ? 2400 : 1600;

  try {
    if (!wantsStream) {
      const answer = await complete(messages, {
        vision: hasImage,
        maxTokens,
        temperature: 0.6,
        deadline,
      });

      const split = hasImage ? splitHeader(answer.text) : null;
      return NextResponse.json({
        reply: (split?.rest ?? answer.text).trim(),
        model: answer.model,
        subject: split?.subject || null,
        problem: split?.problem || null,
      });
    }

    // Which model won the chain. Captured here and sent down the stream so a
    // silent fall-through to the slow free tail is visible rather than just felt.
    let served: string | null = null;

    const source = stream(messages, {
      vision: hasImage,
      maxTokens,
      temperature: 0.6,
      deadline,
      onModel: (m) => { served = m; },
    });

    // Pull the first chunk here, before committing to a 200. Everything that
    // can fail — no key, every model busy, out of credit — fails on this line,
    // and a real HTTP status with a readable sentence is far more useful to the
    // client than an error buried inside a stream it has already started
    // rendering.
    const first = await source.next();
    if (first.done) throw new TutorError("The tutor sent back nothing. Tap Retry.", 502);

    const out = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Held-back text, only ever non-empty while a scan's header is still
        // arriving. Plain chat pushes straight through.
        let buffer = "";
        let headerDone = !hasImage;

        const push = (text: string) => {
          if (text) controller.enqueue(event({ t: "d", v: text }));
        };

        const drain = (chunk: string) => {
          if (headerDone) return push(chunk);

          buffer += chunk;
          const split = splitHeader(buffer);

          if (split) {
            headerDone = true;
            controller.enqueue(
              event({ t: "problem", subject: split.subject, problem: split.problem }),
            );
            buffer = "";
            return push(split.rest);
          }

          // The model ignored the format. Stop waiting and show what we have.
          if (buffer.length > HEADER_LIMIT) {
            headerDone = true;
            push(buffer);
            buffer = "";
          }
        };

        try {
          if (served) controller.enqueue(event({ t: "model", model: served }));
          drain(first.value);
          for await (const chunk of source) drain(chunk);

          // Stream ended while still buffering a header that never came.
          if (!headerDone) push(buffer);

          controller.enqueue(event({ t: "done" }));
        } catch (err) {
          const e = err as TutorError;
          controller.enqueue(
            event({
              t: "error",
              error:
                e?.message ??
                "The tutor stopped partway through. Your work is still here — tap Retry.",
            }),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(out, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        // Nginx and some mobile proxies buffer a response into oblivion
        // otherwise, which turns a streamed reply back into a long blank wait.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const e = err as TutorError;
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    return NextResponse.json(
      {
        error:
          // A 500 from the client layer is always a server misconfiguration —
          // a missing key, or a provider with no model chain. Neither is
          // something the student can fix by retrying, so say so.
          status === 500
            ? "Tutoring isn't configured on this deployment yet."
            : "Couldn't reach a tutor model just now. Your work is still here — tap Retry.",
        detail: e.message,
      },
      { status },
    );
  }
}
