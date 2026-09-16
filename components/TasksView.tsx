"use client";

import { useEffect, useMemo, useState } from "react";
import { list, save, remove, type Task } from "@/lib/store";
import { CheckIcon, PlusIcon, TrashIcon, CloseIcon } from "./Icons";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function TasksView({ userId }: { userId: string | null }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [cursor, setCursor] = useState(() => new Date());
  const [picked, setPicked] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [due, setDue] = useState(iso(new Date()));

  useEffect(() => {
    list("tasks", userId).then((rows) => {
      setTasks(rows);
      setLoading(false);
    });
  }, [userId]);

  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) {
      if (t.due_on && !t.done) map.set(t.due_on, (map.get(t.due_on) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  const shown = useMemo(() => {
    const rows = picked ? tasks.filter((t) => t.due_on === picked) : tasks;
    return [...rows].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.due_on && b.due_on) return a.due_on.localeCompare(b.due_on);
      if (a.due_on) return -1;
      if (b.due_on) return 1;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [tasks, picked]);

  const add = async () => {
    const clean = title.trim();
    if (!clean) return;
    const row = await save("tasks", userId, {
      title: clean,
      subject: subject.trim() || null,
      due_on: due || null,
      done: false,
    } as never);
    setTasks((t) => [row as Task, ...t]);
    setTitle("");
    setSubject("");
    setSheet(false);
  };

  const toggle = async (task: Task) => {
    const next = { ...task, done: !task.done };
    setTasks((all) => all.map((t) => (t.id === task.id ? next : t)));
    await save("tasks", userId, next as never);
  };

  const del = async (task: Task) => {
    setTasks((all) => all.filter((t) => t.id !== task.id));
    await remove("tasks", userId, task.id);
  };

  // Month grid, padded out to whole weeks.
  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());

    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const todayIso = iso(new Date());
  const open = tasks.filter((t) => !t.done).length;

  return (
    <>
      <div className="card">
        <div className="row-between">
          <button
            className="btn icon ghost"
            aria-label="Previous month"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            ‹
          </button>
          <h3 className="cal-month">
            {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
          </h3>
          <button
            className="btn icon ghost"
            aria-label="Next month"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            ›
          </button>
        </div>

        <div className="cal-grid mt12">
          {DAYS.map((d, i) => <div key={i} className="cal-head">{d}</div>)}
          {grid.map((d) => {
            const key = iso(d);
            const out = d.getMonth() !== cursor.getMonth();
            const cls = [
              "cal-day",
              out ? "out" : "",
              key === todayIso ? "today" : "",
              key === picked ? "sel" : "",
            ].filter(Boolean).join(" ");
            return (
              <button
                key={key}
                className={cls}
                onClick={() => { setPicked(picked === key ? null : key); setDue(key); }}
              >
                {d.getDate()}
                {byDay.has(key) && <span className="dot" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="row-between mt20">
        <h3 style={{ fontSize: 15.5 }}>
          {picked ? `Due ${picked}` : "Everything"}
          <span className="muted small" style={{ fontWeight: 500 }}> · {open} open</span>
        </h3>
        {picked && (
          <button className="btn sm ghost" onClick={() => setPicked(null)}>
            <CloseIcon /> All
          </button>
        )}
      </div>

      <div className="card mt12">
        {loading ? (
          <p className="small muted center">Loading…</p>
        ) : shown.length === 0 ? (
          <div className="empty">
            <h3>Nothing due</h3>
            <p>Add what you need to get done.</p>
          </div>
        ) : (
          <div className="list">
            {shown.map((t) => (
              <div key={t.id} className="item">
                <button
                  className={`check ${t.done ? "on" : ""}`}
                  onClick={() => toggle(t)}
                  aria-label={t.done ? "Mark not done" : "Mark done"}
                >
                  {t.done && <CheckIcon />}
                </button>
                <div className="grow">
                  <div className={t.done ? "done" : ""} style={{ fontSize: 15, fontWeight: 550 }}>
                    {t.title}
                  </div>
                  {(t.subject || t.due_on) && (
                    <div className="tiny muted">
                      {[t.subject, t.due_on].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                <button className="btn sm ghost" onClick={() => del(t)} aria-label="Delete">
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="btn block mt16" onClick={() => setSheet(true)}>
        <PlusIcon /> Add something
      </button>

      {sheet && (
        <div className="sheet-bg" onClick={() => setSheet(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="row-between">
              <h3 style={{ fontSize: 17 }}>New task</h3>
              <button className="btn sm ghost" onClick={() => setSheet(false)}><CloseIcon /></button>
            </div>

            <label className="field mt16">
              <span>What</span>
              <input
                className="input"
                value={title}
                autoFocus
                placeholder="Finish chem worksheet"
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
              />
            </label>

            <label className="field mt12">
              <span>Class (optional)</span>
              <input
                className="input"
                value={subject}
                placeholder="Chemistry"
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>

            <label className="field mt12">
              <span>Due</span>
              <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>

            <button className="btn block mt20" onClick={add} disabled={!title.trim()}>
              Add
            </button>
          </div>
        </div>
      )}
    </>
  );
}
