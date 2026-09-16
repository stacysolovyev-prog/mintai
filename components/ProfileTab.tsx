"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import AuthView from "./AuthView";
import { supabase } from "@/lib/supabase";
import { list, saveProfile, type Profile, type Deck, type Quiz, type Task, type TutorSession } from "@/lib/store";
import { ImageIcon } from "./Icons";
import Weather from "./Weather";
import { haptic } from "@/lib/haptics";

type Stats = {
  problems: number;
  cards: number;
  quizAvg: number | null;
  tasksDone: number;
  streak: number;
  recent: TutorSession[];
};

/** Consecutive days up to today that have at least one session. */
function streakFrom(dates: string[]): number {
  const days = new Set(dates.map((d) => d.slice(0, 10)));
  if (!days.size) return 0;

  const cursor = new Date();
  const key = (d: Date) => d.toISOString().slice(0, 10);

  // Yesterday still counts — today may not have started yet.
  if (!days.has(key(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(key(cursor))) return 0;
  }

  let n = 0;
  while (days.has(key(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

export default function ProfileTab({
  user, profile, cloudEnabled, onProfileChange, onSignOut,
}: {
  user: User | null;
  profile: Profile | null;
  cloudEnabled: boolean;
  onProfileChange: () => void;
  onSignOut: () => void;
}) {
  const userId = user?.id ?? null;
  const [stats, setStats] = useState<Stats | null>(null);

  // The weather room. Seven taps on "Your stats" opens it. Deliberately
  // undiscoverable: no affordance, no hint, and the run resets if you pause.
  const [unlocked, setUnlocked] = useState(false);
  const [showWeather, setShowWeather] = useState(false);
  const taps = useRef<{ n: number; last: number }>({ n: 0, last: 0 });

  const secretTap = () => {
    const now = Date.now();
    // More than a second between taps and it is not a deliberate run.
    taps.current.n = now - taps.current.last > 1000 ? 1 : taps.current.n + 1;
    taps.current.last = now;

    if (taps.current.n >= 7 && !unlocked) {
      taps.current.n = 0;
      setUnlocked(true);
      haptic("success");
    } else if (taps.current.n >= 4) {
      // A faint tick from the fourth tap on, so a run feels like it is going
      // somewhere once you are already most of the way there.
      haptic("tap");
    }
  };
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(profile?.display_name ?? "");
    setGrade(profile?.grade ?? "");
  }, [profile]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      list("sessions", userId),
      list("decks", userId),
      list("quizzes", userId),
      list("tasks", userId),
    ]).then(([sessions, decks, quizzes, tasks]) => {
      if (!alive) return;
      const scored = (quizzes as Quiz[]).filter((q) => q.score != null && q.total);
      setStats({
        problems: sessions.length,
        cards: (decks as Deck[]).reduce((n, d) => n + (d.cards?.length ?? 0), 0),
        quizAvg: scored.length
          ? Math.round(
              (scored.reduce((n, q) => n + q.score! / q.total!, 0) / scored.length) * 100,
            )
          : null,
        tasksDone: (tasks as Task[]).filter((t) => t.done).length,
        streak: streakFrom((sessions as TutorSession[]).map((s) => s.created_at)),
        recent: (sessions as TutorSession[]).slice(0, 5),
      });
    });
    return () => { alive = false; };
  }, [userId]);

  const initials = useMemo(() => {
    const from = profile?.display_name || user?.email || "";
    return from.trim().slice(0, 1).toUpperCase();
  }, [profile?.display_name, user?.email]);

  const persist = async () => {
    if (!userId) return;
    setSaving(true);
    await saveProfile(userId, { display_name: name.trim() || null, grade: grade.trim() || null });
    onProfileChange();
    setSaving(false);
  };

  const upload = async (file?: File) => {
    const db = supabase();
    if (!file || !userId || !db) return;
    setUploadErr(null);

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/avatar.${ext}`;

    const { error } = await db.storage.from("avatars").upload(path, file, { upsert: true });
    if (error) return setUploadErr(error.message);

    const { data } = db.storage.from("avatars").getPublicUrl(path);
    // Cache-bust so a re-upload actually shows.
    await saveProfile(userId, { avatar_url: `${data.publicUrl}?v=${Date.now()}` });
    onProfileChange();
  };

  return (
    <>
      {user ? (
        <>
          <div className="card">
            <div className="row" style={{ gap: 14 }}>
              <div className="avatar">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" />
                ) : (
                  <span style={{ fontSize: 28, fontWeight: 700, color: "var(--mint)" }}>{initials}</span>
                )}
              </div>
              <div className="grow col" style={{ gap: 3 }}>
                <span style={{ fontSize: 17, fontWeight: 650 }}>
                  {profile?.display_name || user.email?.split("@")[0]}
                </span>
                <span className="tiny muted">{user.email}</span>
                <button
                  className="btn sm secondary mt8"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImageIcon /> Photo
                </button>
              </div>
            </div>
            {uploadErr && <p className="small mt12" style={{ color: "var(--red)" }}>{uploadErr}</p>}
            <input
              ref={fileRef} type="file" accept="image/*" hidden
              onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }}
            />
          </div>

          <div className="card">
            <label className="field">
              <span>Name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field mt12">
              <span>Year or grade</span>
              <input className="input" value={grade} placeholder="Year 10"
                     onChange={(e) => setGrade(e.target.value)} />
            </label>
            <button className="btn block mt16" onClick={persist} disabled={saving}>
              {saving ? <span className="spin" /> : "Save"}
            </button>
          </div>
        </>
      ) : cloudEnabled ? (
        <AuthView />
      ) : (
        <div className="card center">
          <h2 className="mt12" style={{ fontSize: 18 }}>Working on this device</h2>
          <p className="small muted mt8">
            Accounts aren&apos;t switched on for this deployment. Everything still saves locally.
          </p>
        </div>
      )}

      <h3 className="mt24" style={{ fontSize: 15.5 }} onClick={secretTap}>Your stats</h3>

      {unlocked && (
        <button className="btn secondary block mt12 wx-open" onClick={() => { haptic("tap"); setShowWeather(true); }}>
          Weather
        </button>
      )}

      {showWeather && <Weather onClose={() => setShowWeather(false)} />}

      <div className="stats mt12">
        <div className="stat">
          <div className="n">{stats?.problems ?? "—"}</div>
          <div className="l">Problems</div>
        </div>
        <div className="stat">
          <div className="n">{stats?.streak ?? "—"}</div>
          <div className="l">Day streak</div>
        </div>
        <div className="stat">
          <div className="n">{stats?.cards ?? "—"}</div>
          <div className="l">Cards</div>
        </div>
        <div className="stat">
          <div className="n">{stats?.quizAvg != null ? `${stats.quizAvg}%` : "—"}</div>
          <div className="l">Quiz average</div>
        </div>
        <div className="stat">
          <div className="n">{stats?.tasksDone ?? "—"}</div>
          <div className="l">Done</div>
        </div>
        <div className="stat">
          <div className="n">{stats?.recent.length ?? "—"}</div>
          <div className="l">Recent</div>
        </div>
      </div>

      {stats && stats.recent.length > 0 && (
        <div className="card mt16">
          <h3 style={{ fontSize: 15 }}>Lately</h3>
          <div className="list mt8">
            {stats.recent.map((s) => (
              <div key={s.id} className="item col" style={{ alignItems: "flex-start", gap: 2 }}>
                <span className="small" style={{ fontWeight: 570 }}>
                  {s.title || s.problem || "Session"}
                </span>
                <span className="tiny muted">
                  {s.source} · {s.mode} · {new Date(s.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {user && (
        <button className="btn danger block mt20" onClick={onSignOut}>
          Sign out
        </button>
      )}
    </>
  );
}
