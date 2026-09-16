"use client";

import { useEffect, useState } from "react";
import { list, save, remove, type Quiz, type Question } from "@/lib/store";
import { postJson } from "@/lib/api";
import { PlusIcon, TrashIcon, CloseIcon, BackIcon } from "./Icons";

export default function QuizView({ userId }: { userId: string | null }) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Quiz | null>(null);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    list("quizzes", userId).then((rows) => { setQuizzes(rows); setLoading(false); });
  }, [userId]);

  if (open) {
    return (
      <Take
        quiz={open}
        userId={userId}
        onBack={() => setOpen(null)}
        onScored={(score, total) => {
          setQuizzes((all) => all.map((q) => (q.id === open.id ? { ...q, score, total } : q)));
        }}
      />
    );
  }

  return (
    <>
      {loading ? (
        <p className="small muted center">Loading…</p>
      ) : quizzes.length === 0 ? (
        <div className="card">
          <div className="empty">
            <h3 className="mt12">No quizzes yet</h3>
            <p>Turn your notes into questions and find the gaps.</p>
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {quizzes.map((q) => (
            <div key={q.id} className="card row" style={{ padding: 15 }}>
              <button className="grow col" style={{ textAlign: "left", gap: 2 }} onClick={() => setOpen(q)}>
                <span style={{ fontSize: 15.5, fontWeight: 620 }}>{q.title}</span>
                <span className="tiny muted">
                  {q.questions.length} questions
                  {q.score != null && q.total ? ` · last score ${q.score}/${q.total}` : ""}
                </span>
              </button>
              <button
                className="btn sm ghost"
                aria-label="Delete quiz"
                onClick={async () => {
                  setQuizzes((all) => all.filter((x) => x.id !== q.id));
                  await remove("quizzes", userId, q.id);
                }}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      <button className="btn block mt16" onClick={() => setSheet(true)}>
        <PlusIcon /> Make a quiz
      </button>

      {sheet && (
        <MakeSheet
          userId={userId}
          onClose={() => setSheet(false)}
          onDone={(quiz) => { setQuizzes((all) => [quiz, ...all]); setSheet(false); setOpen(quiz); }}
        />
      )}
    </>
  );
}

function MakeSheet({
  userId, onClose, onDone,
}: {
  userId: string | null;
  onClose: () => void;
  onDone: (q: Quiz) => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{ data?: { questions?: Question[] } }>("/api/study", {
        kind: "quiz", source: notes, count,
      });

      // Drop anything malformed rather than crashing mid-quiz.
      const questions = (data.data?.questions ?? []).filter(
        (q) =>
          q && typeof q.q === "string" &&
          Array.isArray(q.options) && q.options.length >= 2 &&
          typeof q.answer === "number" && q.answer >= 0 && q.answer < q.options.length,
      );
      if (!questions.length) throw new Error("Nothing usable came back — try more detailed notes.");

      const quiz = (await save("quizzes", userId, {
        title: title.trim() || questions[0].q.slice(0, 50),
        subject: null,
        questions,
        score: null,
        total: null,
      } as never)) as Quiz;

      onDone(quiz);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h3 style={{ fontSize: 17 }}>Make a quiz</h3>
          <button className="btn sm ghost" onClick={onClose}><CloseIcon /></button>
        </div>

        <label className="field mt16">
          <span>Name (optional)</span>
          <input className="input" value={title} placeholder="Unit 3 review"
                 onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label className="field mt12">
          <span>Your notes</span>
          <textarea
            className="textarea"
            rows={7}
            value={notes}
            placeholder="Paste notes or a chapter summary…"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <div className="row mt12" style={{ gap: 7 }}>
          {[4, 6, 10, 15].map((n) => (
            <button key={n} className={`chip ${count === n ? "on" : ""}`} onClick={() => setCount(n)}>{n}</button>
          ))}
          <span className="tiny muted">questions</span>
        </div>

        {error && <p className="small mt12" style={{ color: "var(--red)" }}>{error}</p>}

        <button className="btn block mt20" onClick={go} disabled={busy || notes.trim().length < 20}>
          {busy ? <><span className="spin" /> Writing…</> : "Make it"}
        </button>
      </div>
    </div>
  );
}

function Take({
  quiz, userId, onBack, onScored,
}: {
  quiz: Quiz;
  userId: string | null;
  onBack: () => void;
  onScored: (score: number, total: number) => void;
}) {
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  const q = quiz.questions[i];
  const last = i === quiz.questions.length - 1;

  const pick = (n: number) => {
    if (chosen !== null) return;
    setChosen(n);
    if (n === q.answer) setScore((s) => s + 1);
  };

  const next = async () => {
    if (last) {
      const final = score;
      setDone(true);
      onScored(final, quiz.questions.length);
      await save("quizzes", userId, {
        ...quiz, score: final, total: quiz.questions.length,
      } as never);
    } else {
      setI((n) => n + 1);
      setChosen(null);
    }
  };

  if (done) {
    const pct = Math.round((score / quiz.questions.length) * 100);
    return (
      <>
        <div className="card center">
          <h2 className="score" style={{ fontSize: 34 }}>{score} / {quiz.questions.length}</h2>
          <p className="small muted mt8">
            {pct >= 90 ? "You know this one." :
             pct >= 70 ? "Solid. Worth another pass on the misses." :
             pct >= 40 ? "Good start — the gaps are clear now." :
                         "Fresh topic. Try Explain mode on it, then come back."}
          </p>
        </div>
        <button className="btn block mt16" onClick={() => { setI(0); setChosen(null); setScore(0); setDone(false); }}>
          Try again
        </button>
        <button className="btn ghost block mt12" onClick={onBack}>Back to quizzes</button>
      </>
    );
  }

  return (
    <>
      <div className="row-between">
        <button className="btn sm ghost" onClick={onBack}><BackIcon /> Quizzes</button>
        <span className="small muted">{i + 1} of {quiz.questions.length}</span>
      </div>

      <div className="card mt12">
        <p style={{ fontSize: 16.5, fontWeight: 600, lineHeight: 1.35 }}>{q.q}</p>

        <div className="mt16">
          {q.options.map((opt, n) => {
            const cls =
              chosen === null ? "opt" :
              n === q.answer ? "opt right" :
              n === chosen ? "opt wrong" : "opt";
            return (
              <button key={n} className={cls} onClick={() => pick(n)} disabled={chosen !== null}>
                {opt}
              </button>
            );
          })}
        </div>

        {chosen !== null && q.why && (
          <p className="small muted mt16" style={{ lineHeight: 1.5 }}>{q.why}</p>
        )}
      </div>

      {chosen !== null && (
        <button className="btn block mt16" onClick={next}>
          {last ? "See score" : "Next"}
        </button>
      )}
    </>
  );
}
