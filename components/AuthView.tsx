"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { GoogleIcon } from "./Icons";

export default function AuthView() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const google = async () => {
    const db = supabase();
    if (!db) return;
    setBusy(true);
    setError(null);
    const { error } = await db.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setError(
        error.message.toLowerCase().includes("provider")
          ? "Google sign-in isn't switched on for this project yet. Use email for now."
          : error.message,
      );
      setBusy(false);
    }
  };

  const submit = async () => {
    const db = supabase();
    if (!db) return;

    setBusy(true);
    setError(null);

    try {
      if (mode === "up") {
        const { data, error } = await db.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: name.trim() || email.split("@")[0] },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        // Projects with email confirmation on return a user with no session.
        if (!data.session) setSent(true);
      } else {
        const { error } = await db.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="card center">
        <h2 style={{ fontSize: 18 }}>Check your email</h2>
        <p className="small muted mt8">
          We sent a confirmation link to {email}. Open it and you&apos;re in.
        </p>
      </div>
    );
  }

  const valid = email.includes("@") && password.length >= 6;

  return (
    <>
      <div className="card center">
        <h2 style={{ fontSize: 19 }}>
          {mode === "in" ? "Sign in" : "Make an account"}
        </h2>
        <p className="small muted mt8">
          Keeps your notes, cards and to-do list on every device.
        </p>
      </div>

      <button className="btn ghost block mt16" onClick={google} disabled={busy}>
        <GoogleIcon /> Continue with Google
      </button>

      <div className="row mt16" style={{ gap: 12 }}>
        <span className="divider grow" style={{ margin: 0 }} />
        <span className="tiny muted">or</span>
        <span className="divider grow" style={{ margin: 0 }} />
      </div>

      {mode === "up" && (
        <label className="field mt16">
          <span>Name</span>
          <input className="input" value={name} placeholder="Your name"
                 autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </label>
      )}

      <label className="field mt12">
        <span>Email</span>
        <input
          className="input"
          type="email"
          value={email}
          placeholder="you@example.com"
          autoComplete="email"
          autoCapitalize="off"
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label className="field mt12">
        <span>Password</span>
        <input
          className="input"
          type="password"
          value={password}
          placeholder="At least 6 characters"
          autoComplete={mode === "up" ? "new-password" : "current-password"}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && valid && submit()}
        />
      </label>

      {error && <p className="small mt12" style={{ color: "var(--red)" }}>{error}</p>}

      <button className="btn block mt16" onClick={submit} disabled={busy || !valid}>
        {busy ? <span className="spin" /> : mode === "in" ? "Sign in" : "Create account"}
      </button>

      <button
        className="btn ghost block mt12"
        onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(null); }}
      >
        {mode === "in" ? "No account? Sign up" : "Already have one? Sign in"}
      </button>

      <p className="tiny muted center mt16">
        You don&apos;t have to sign in. Without an account everything stays on this device.
      </p>
    </>
  );
}
