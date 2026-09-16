"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { list, save, remove, type Recap, type Term } from "@/lib/store";
import { recognitionCtor, type Recognition } from "@/lib/speech";
import { postJson } from "@/lib/api";
import { PlusIcon, TrashIcon, CloseIcon, BackIcon, CheckIcon, VoiceIcon, StopIcon } from "./Icons";

export default function ClassView({ userId }: { userId: string | null }) {
  const [recaps, setRecaps] = useState<Recap[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Recap | null>(null);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    list("recaps", userId).then((rows) => { setRecaps(rows); setLoading(false); });
  }, [userId]);

  if (open) return <Detail recap={open} userId={userId} onBack={() => setOpen(null)} />;

  return (
    <>
      {loading ? (
        <p className="small muted center">Loading…</p>
      ) : recaps.length === 0 ? (
        <div className="card">
          <div className="empty">
            <h3 className="mt12">No class notes yet</h3>
            <p>Record the lesson or paste your notes, and get a recap you can revise from.</p>
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {recaps.map((r) => (
            <div key={r.id} className="card row" style={{ padding: 15 }}>
              <button className="grow col" style={{ textAlign: "left", gap: 2 }} onClick={() => setOpen(r)}>
                <span style={{ fontSize: 15.5, fontWeight: 620 }}>{r.title}</span>
                <span className="tiny muted">
                  {new Date(r.created_at).toLocaleDateString()} · {r.points.length} points
                </span>
              </button>
              <button
                className="btn sm ghost"
                aria-label="Delete recap"
                onClick={async () => {
                  setRecaps((all) => all.filter((x) => x.id !== r.id));
                  await remove("recaps", userId, r.id);
                }}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      <button className="btn block mt16" onClick={() => setSheet(true)}>
        <PlusIcon /> New class
      </button>

      {sheet && (
        <Capture
          userId={userId}
          onClose={() => setSheet(false)}
          onDone={(r) => { setRecaps((all) => [r, ...all]); setSheet(false); setOpen(r); }}
        />
      )}
    </>
  );
}

/* --------------- record or paste, then recap --------------- */

function Capture({
  userId, onClose, onDone,
}: {
  userId: string | null;
  onClose: () => void;
  onDone: (r: Recap) => void;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false);

  useEffect(() => setSupported(recognitionCtor() !== null), []);

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return setSupported(false);

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let chunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) chunk += e.results[i][0].transcript + " ";
      }
      if (chunk) setText((t) => (t + " " + chunk).replace(/\s{2,}/g, " ").trimStart());
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed") {
        setError("Microphone access was blocked. Allow it, or type your notes instead.");
        wantRef.current = false;
        setRecording(false);
      }
    };

    // Browsers cut continuous recognition off after a pause — restart while the
    // user still wants to be recording, so a whole lesson gets captured.
    rec.onend = () => {
      if (wantRef.current) {
        try { rec.start(); } catch { setRecording(false); }
      } else {
        setRecording(false);
      }
    };

    wantRef.current = true;
    recRef.current = rec;
    setError(null);
    try { rec.start(); setRecording(true); } catch { setError("Couldn't start recording."); }
  }, []);

  const go = async () => {
    stop();
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{ data?: Record<string, unknown> }>("/api/study", {
        kind: "recap", source: text,
      });

      const d = (data.data ?? {}) as {
        title?: string; summary?: string;
        points?: string[]; terms?: unknown[]; todo?: string[];
      };
      const recap = (await save("recaps", userId, {
        title: d.title || "Class notes",
        subject: null,
        summary: d.summary ?? null,
        points: Array.isArray(d.points) ? d.points : [],
        terms: Array.isArray(d.terms) ? d.terms : [],
        transcript: text,
      } as never)) as Recap;

      // Homework the teacher mentioned goes straight onto the to-do list.
      const todos: string[] = Array.isArray(d.todo) ? d.todo : [];
      for (const t of todos.slice(0, 8)) {
        if (typeof t === "string" && t.trim()) {
          await save("tasks", userId, {
            title: t.trim(), subject: d.title ?? null, due_on: null, done: false,
          } as never);
        }
      }

      onDone(recap);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="sheet-bg" onClick={() => { stop(); onClose(); }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h3 style={{ fontSize: 17 }}>New class</h3>
          <button className="btn sm ghost" onClick={() => { stop(); onClose(); }}><CloseIcon /></button>
        </div>

        {supported ? (
          <button
            className={`btn block mt16 ${recording ? "danger" : "secondary"}`}
            onClick={() => (recording ? stop() : start())}
          >
            {recording ? <><StopIcon /> Stop recording</> : <><VoiceIcon /> Record the class</>}
          </button>
        ) : (
          <div className="banner mt16">
            Live transcription needs Safari on iPhone or Chrome. You can still type or paste notes.
          </div>
        )}

        {recording && (
          <p className="tiny muted center mt8">
            Listening — keep this screen open. {words} words so far.
          </p>
        )}

        <label className="field mt16">
          <span>Notes {words > 0 && !recording ? `· ${words} words` : ""}</span>
          <textarea
            className="textarea"
            rows={8}
            value={text}
            placeholder="Transcript appears here as you record, or type your notes…"
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        {error && <p className="small mt12" style={{ color: "var(--red)" }}>{error}</p>}

        <button className="btn block mt16" onClick={go} disabled={busy || text.trim().length < 20}>
          {busy ? <><span className="spin" /> Writing recap…</> : "Make the recap"}
        </button>
      </div>
    </div>
  );
}

/* ----------------------- recap detail ----------------------- */

function Detail({
  recap, userId, onBack,
}: {
  recap: Recap;
  userId: string | null;
  onBack: () => void;
}) {
  const [added, setAdded] = useState<Record<number, boolean>>({});
  const [showRaw, setShowRaw] = useState(false);

  return (
    <>
      <button className="btn sm ghost" onClick={onBack}><BackIcon /> Classes</button>

      <div className="card mt12">
        <h2 style={{ fontSize: 19 }}>{recap.title}</h2>
        <p className="tiny muted mt8">{new Date(recap.created_at).toLocaleString()}</p>
        {recap.summary && <p className="small mt12" style={{ lineHeight: 1.55 }}>{recap.summary}</p>}
      </div>

      {recap.points.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: 15 }}>Worth remembering</h3>
          <div className="list mt8">
            {recap.points.map((p, i) => (
              <div key={i} className="item">
                <button
                  className={`check ${added[i] ? "on" : ""}`}
                  aria-label="Add to tasks"
                  onClick={async () => {
                    if (added[i]) return;
                    setAdded((a) => ({ ...a, [i]: true }));
                    await save("tasks", userId, {
                      title: `Review: ${p}`, subject: recap.title, due_on: null, done: false,
                    } as never);
                  }}
                >
                  {added[i] && <CheckIcon />}
                </button>
                <span className="grow small">{p}</span>
              </div>
            ))}
          </div>
          <p className="tiny muted mt12">Tap a circle to add it to your to-do list.</p>
        </div>
      )}

      {recap.terms.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: 15 }}>Words that came up</h3>
          <div className="list mt8">
            {(recap.terms as Term[]).map((t, i) => (
              <div key={i} className="item col" style={{ alignItems: "flex-start", gap: 2 }}>
                <span style={{ fontSize: 14.5, fontWeight: 620 }}>{t.term}</span>
                <span className="small muted">{t.def}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recap.transcript && (
        <>
          <button className="btn ghost block mt16" onClick={() => setShowRaw((s) => !s)}>
            {showRaw ? "Hide transcript" : "Show transcript"}
          </button>
          {showRaw && (
            <div className="card mt12">
              <p className="small muted" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {recap.transcript}
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
}
