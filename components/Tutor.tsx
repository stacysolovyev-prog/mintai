"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import { SendIcon, VideoIcon, PlayIcon } from "./Icons";
import { save, type ChatMsg, type TutorSession } from "@/lib/store";
import { postJson, postStream } from "@/lib/api";
import { haptic } from "@/lib/haptics";

type Video = { title: string; channel: string; why: string; url: string; thumb: string | null };

export type TutorHandle = { start: (image: string, caption?: string) => void };

/**
 * The tutoring conversation. Scan and Chat both mount this — Scan feeds it a
 * photo, Chat feeds it text. Everything about staying unstuck lives here.
 *
 * The reply streams in. That is the single biggest thing that makes this feel
 * fast: the first words land in well under a second, so there is never a blank
 * bubble to sit and watch.
 */
export default function Tutor({
  source,
  userId,
  seed,
  onProblem,
  placeholder = "What are you stuck on?",
}: {
  source: "scan" | "chat";
  userId: string | null;
  seed?: { image: string; caption?: string } | null;
  onProblem?: (p: { subject: string | null; problem: string | null }) => void;
  placeholder?: string;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [live, setLive] = useState<string | null>(null);
  const [mode, setMode] = useState<"guide" | "explain">("guide");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [vidBusy, setVidBusy] = useState(false);
  const [topic, setTopic] = useState<string>("");

  // What to re-send if a request fails. The user's photo and words are never
  // thrown away on an error — Retry replays exactly this.
  const pending = useRef<{ history: ChatMsg[]; image: string | null } | null>(null);
  const sessionId = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  // Drop any in-flight stream when this unmounts, so a half-finished reply
  // cannot call setState on a component that is gone.
  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, live, busy, videos]);

  const persist = useCallback(
    async (all: ChatMsg[], subject: string | null, problem: string | null) => {
      if (!all.length) return;
      const row = {
        id: sessionId.current ?? undefined,
        mode,
        source,
        subject,
        problem,
        title: (problem || all[0]?.content || "Session").slice(0, 70),
        // Images are big; keep them out of storage and keep the text.
        messages: all.map(({ role, content }) => ({ role, content })),
      };
      const saved = (await save("sessions", userId, row as never)) as TutorSession;
      sessionId.current = saved.id;
    },
    [mode, source, userId],
  );

  const run = useCallback(
    async (history: ChatMsg[], image: string | null) => {
      pending.current = { history, image };
      abort.current?.abort();
      const control = new AbortController();
      abort.current = control;

      setBusy(true);
      setError(null);
      setLive("");

      let reply = "";
      let subject: string | null = null;
      let problem: string | null = null;
      let failed: string | null = null;
      let landed = false;

      try {
        const events = postStream(
          "/api/tutor",
          {
            messages: history.map(({ role, content }) => ({ role, content })),
            mode,
            image,
          },
          control.signal,
        );

        for await (const ev of events) {
          if (ev.t === "problem") {
            // A scanned photo comes back readable — fold it into the first
            // user turn so follow-ups have context without re-sending the image.
            subject = ev.subject || null;
            problem = ev.problem || null;
            if (problem) {
              setTopic(problem);
              onProblem?.({ subject, problem });
            }
          } else if (ev.t === "d") {
            if (!landed) {
              landed = true;
              // The first words of the answer arriving is the moment worth
              // feeling, the same as a text landing.
              haptic("success");
            }
            reply += ev.v;
            setLive(reply);
          } else if (ev.t === "error") {
            failed = ev.error;
          }
        }
      } catch (e) {
        failed = (e as Error).message;
      }

      if (control.signal.aborted) return;

      // A stream that broke partway still has real text in it. Keep what
      // arrived, show the problem underneath it, and let Retry replace it.
      const finished = reply.trim();

      if (finished) {
        const base: ChatMsg[] =
          image && problem ? [{ role: "user", content: problem, image }, ...history] : history;
        const all: ChatMsg[] = [...base, { role: "assistant", content: finished }];
        setMsgs(all);
        pending.current = failed ? pending.current : null;
        void persist(all, subject, problem);
      }

      if (failed) {
        setError(failed);
        haptic("error");
      }

      setLive(null);
      setBusy(false);
    },
    [mode, onProblem, persist],
  );

  // A photo arriving from the Scan tab.
  useEffect(() => {
    if (!seed?.image) return;
    setMsgs([{ role: "user", content: seed.caption ?? "", image: seed.image }]);
    setVideos(null);
    sessionId.current = null;
    void run([], seed.image);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.image]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    haptic("send");
    setDraft("");
    if (!topic) setTopic(text);
    const history: ChatMsg[] = [...msgs, { role: "user", content: text }];
    setMsgs(history);
    void run(history, null);
  };

  const retry = () => {
    const p = pending.current;
    if (!p) return;
    haptic("tap");
    void run(p.history, p.image);
  };

  const findVideos = async () => {
    const q = topic || msgs.find((m) => m.role === "user")?.content;
    if (!q) return;
    haptic("tap");
    setVidBusy(true);
    try {
      const data = await postJson<{ videos?: Video[] }>("/api/videos", { topic: q });
      setVideos(data.videos ?? []);
    } catch {
      setVideos([]);
    } finally {
      setVidBusy(false);
    }
  };

  const started = msgs.length > 0 || live !== null;

  // One list for what is on screen: the settled messages, plus the reply
  // currently arriving. An empty streaming message renders as the typing dots.
  const thread: ChatMsg[] =
    live !== null ? [...msgs, { role: "assistant", content: live }] : msgs;

  return (
    <div className="col tutor" style={{ gap: 14 }}>
      <div className="seg">
        <button
          className={mode === "guide" ? "on" : ""}
          onClick={() => {
            haptic("tap");
            setMode("guide");
          }}
        >
          Guide me
        </button>
        <button
          className={mode === "explain" ? "on" : ""}
          onClick={() => {
            haptic("tap");
            setMode("explain");
          }}
        >
          Explain it
        </button>
      </div>

      <p className="tiny muted" style={{ marginTop: -4 }}>
        {mode === "guide"
          ? "Questions that get you to the answer yourself."
          : "The idea broken down — still not your homework answer."}
      </p>

      {!started && (
        <div className="empty">
          <h3>{source === "scan" ? "Take a photo of the problem" : "Type the problem"}</h3>
          <p>You get the questions, not the answers.</p>
        </div>
      )}

      {started && (
        <div className="thread">
          {/* The streaming reply is rendered as the LAST ITEM OF THE SAME LIST,
              not as a sibling after it. When the stream finishes and the real
              message takes its place, it lands on the same key at the same
              index, so React updates it in place. Rendered as a sibling it
              unmounts and a fresh bubble mounts, which replays the entry
              animation and makes the finished answer visibly flicker. */}
          {thread.map((m, i) => (
            <div key={i} className={`msg ${m.role === "user" ? "me" : "bot"}`}>
              {m.image && (
                <img src={m.image} alt="The problem you scanned" style={{ marginBottom: m.content ? 9 : 0 }} />
              )}
              {m.role === "assistant" && !m.content ? (
                <span className="dots">
                  <i /><i /><i />
                </span>
              ) : (
                m.content &&
                (m.role === "assistant" ? <Markdown text={m.content} /> : <p>{m.content}</p>)
              )}
            </div>
          ))}

          {error && (
            <div className="msg err">
              <p>{error}</p>
              <button className="btn sm secondary mt8" onClick={retry} disabled={busy}>
                Retry
              </button>
            </div>
          )}

          <div ref={endRef} />
        </div>
      )}

      {started && !busy && !error && (
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn sm secondary" onClick={findVideos} disabled={vidBusy}>
            {vidBusy ? <span className="spin dark" /> : <VideoIcon />}
            {vidBusy ? "Finding" : "Short videos"}
          </button>
          <button
            className="btn sm ghost"
            onClick={() => {
              haptic("tap");
              setDraft("I'm still stuck. Ask me something smaller.");
            }}
          >
            Still stuck
          </button>
        </div>
      )}

      {videos && (
        <div className="card">
          <h3 style={{ fontSize: 15 }}>Worth watching</h3>
          <p className="tiny muted mt8">Short, visual, gets to the point.</p>
          <div className="col mt12" style={{ gap: 9 }}>
            {videos.length === 0 && <p className="small muted">Nothing good found — try rewording the topic.</p>}
            {videos.map((v, i) => (
              <a key={i} className="vid" href={v.url} target="_blank" rel="noreferrer">
                <span className="thumb">
                  {v.thumb ? <img src={v.thumb} alt="" /> : <PlayIcon className="" />}
                </span>
                <span className="grow">
                  <span className="t" style={{ display: "block" }}>{v.title}</span>
                  <span className="s" style={{ display: "block" }}>{v.channel} · {v.why}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="composer">
        <textarea
          className="textarea grow"
          rows={1}
          value={draft}
          placeholder={started ? "Answer, or say you're stuck" : placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 130)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          className="btn send"
          onClick={send}
          disabled={busy || !draft.trim()}
          aria-label="Send"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}
