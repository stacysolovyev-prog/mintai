"use client";

import { useEffect, useState } from "react";

type Health = {
  ok: boolean;
  checks?: { tutor?: { openrouter_key_set?: boolean; key_looks_right?: boolean } };
};

/**
 * If the deployment has no OpenRouter key, Scan, Chat and Voice all fail with
 * a 500 the moment you use them — which reads as "the app is broken" rather
 * than "one setting is missing". This says which setting, and where it goes.
 */
export default function SetupBanner() {
  const [bad, setBad] = useState<null | "missing" | "malformed">(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: Health) => {
        if (!alive || h.ok) return;
        setBad(h.checks?.tutor?.openrouter_key_set ? "malformed" : "missing");
      })
      .catch(() => {
        /* health itself is down; the per-request errors still explain things */
      });
    return () => { alive = false; };
  }, []);

  if (!bad || hidden) return null;

  return (
    <div className="setup">
      <div className="grow">
        <strong>Tutoring is switched off on this deployment.</strong>
        <p className="mt8">
          {bad === "missing"
            ? "No model API key is set, so Scan, Chat and Voice can't reach a model. Set OPENROUTER_API_KEY, or NVIDIA_API_KEY with a model chain."
            : "A key is set but doesn't look right — OpenRouter keys start with sk-or-, NVIDIA keys with nvapi-."}
        </p>
        <p className="mt8">
          Add it in Vercel → your project → Settings → Environment Variables, then
          redeploy. Everything else — to-do, cards, quizzes, the calculator —
          works without it.
        </p>
      </div>
      <button className="setup-x" onClick={() => setHidden(true)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
