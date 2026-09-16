"use client";

import { useEffect, useState } from "react";
import { list, save, remove, type Deck, type Card } from "@/lib/store";
import { postJson } from "@/lib/api";
import { PlusIcon, TrashIcon, CloseIcon, BackIcon } from "./Icons";

export default function CardsView({ userId }: { userId: string | null }) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Deck | null>(null);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    list("decks", userId).then((rows) => { setDecks(rows); setLoading(false); });
  }, [userId]);

  if (open) {
    return <Study deck={open} onBack={() => setOpen(null)} />;
  }

  return (
    <>
      {loading ? (
        <p className="small muted center">Loading…</p>
      ) : decks.length === 0 ? (
        <div className="card">
          <div className="empty">
            <h3 className="mt12">No cards yet</h3>
            <p>Paste your notes and get a deck back.</p>
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {decks.map((d) => (
            <div key={d.id} className="card row" style={{ padding: 15 }}>
              <button className="grow col" style={{ textAlign: "left", gap: 2 }} onClick={() => setOpen(d)}>
                <span style={{ fontSize: 15.5, fontWeight: 620 }}>{d.title}</span>
                <span className="tiny muted">
                  {d.cards.length} card{d.cards.length === 1 ? "" : "s"}
                  {d.subject ? ` · ${d.subject}` : ""}
                </span>
              </button>
              <button
                className="btn sm ghost"
                aria-label="Delete deck"
                onClick={async () => {
                  setDecks((all) => all.filter((x) => x.id !== d.id));
                  await remove("decks", userId, d.id);
                }}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      <button className="btn block mt16" onClick={() => setSheet(true)}>
        <PlusIcon /> Make cards
      </button>

      {sheet && (
        <MakeSheet
          userId={userId}
          onClose={() => setSheet(false)}
          onDone={(deck) => { setDecks((all) => [deck, ...all]); setSheet(false); setOpen(deck); }}
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
  onDone: (d: Deck) => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [count, setCount] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{ data?: { cards?: Card[] } }>("/api/study", {
        kind: "cards", source: notes, count,
      });

      const cards = data.data?.cards ?? [];
      if (!cards.length) throw new Error("Nothing came back — try more detailed notes.");

      const deck = (await save("decks", userId, {
        title: title.trim() || cards[0].front.slice(0, 50),
        subject: null,
        cards,
      } as never)) as Deck;

      onDone(deck);
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
          <h3 style={{ fontSize: 17 }}>Make cards</h3>
          <button className="btn sm ghost" onClick={onClose}><CloseIcon /></button>
        </div>

        <label className="field mt16">
          <span>Name (optional)</span>
          <input className="input" value={title} placeholder="Cell biology"
                 onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label className="field mt12">
          <span>Your notes</span>
          <textarea
            className="textarea"
            rows={7}
            value={notes}
            placeholder="Paste notes, a chapter summary, or a list of terms…"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <div className="row mt12" style={{ gap: 7 }}>
          {[5, 8, 12, 15].map((n) => (
            <button key={n} className={`chip ${count === n ? "on" : ""}`} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
          <span className="tiny muted">cards</span>
        </div>

        {error && <p className="small mt12" style={{ color: "var(--red)" }}>{error}</p>}

        <button className="btn block mt20" onClick={go} disabled={busy || notes.trim().length < 20}>
          {busy ? <><span className="spin" /> Making…</> : "Make them"}
        </button>
      </div>
    </div>
  );
}

function Study({ deck, onBack }: { deck: Deck; onBack: () => void }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [order, setOrder] = useState(() => deck.cards.map((_, n) => n));

  const card = deck.cards[order[i]];
  const next = (step: number) => {
    setFlipped(false);
    setI((n) => Math.min(Math.max(n + step, 0), order.length - 1));
  };

  if (!card) return <p className="small muted">This deck is empty.</p>;

  return (
    <>
      <div className="row-between">
        <button className="btn sm ghost" onClick={onBack}><BackIcon /> Decks</button>
        <span className="small muted">{i + 1} of {order.length}</span>
      </div>

      <h3 className="mt12" style={{ fontSize: 16 }}>{deck.title}</h3>

      <button
        className={`flip mt16 ${flipped ? "on" : ""}`}
        style={{ width: "100%", display: "block" }}
        onClick={() => setFlipped((f) => !f)}
      >
        <div className="flip-in">
          <div className="face">{card.front}</div>
          <div className="face back">{card.back}</div>
        </div>
      </button>

      <p className="tiny muted center mt12">Tap the card to flip</p>

      <div className="row mt16" style={{ gap: 9 }}>
        <button className="btn secondary grow" onClick={() => next(-1)} disabled={i === 0}>Back</button>
        <button className="btn grow" onClick={() => next(1)} disabled={i === order.length - 1}>Next</button>
      </div>

      <button
        className="btn ghost block mt12"
        onClick={() => {
          const shuffled = [...order];
          for (let k = shuffled.length - 1; k > 0; k--) {
            const j = Math.floor(Math.random() * (k + 1));
            [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
          }
          setOrder(shuffled);
          setI(0);
          setFlipped(false);
        }}
      >
        Shuffle
      </button>
    </>
  );
}
