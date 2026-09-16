import { NextResponse } from "next/server";
import { CLOUD_ENABLED, SUPABASE_FROM_ENV, SUPABASE_URL } from "@/lib/config";
import { modelChain, complete } from "@/lib/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deployment self-check. Visit /api/health on the deployed site to see what is
 * actually configured there. Reports only whether values are present and how
 * they are shaped — never the values themselves.
 */
export async function GET(req: Request) {
  // Either provider's key counts. Reporting "add OPENROUTER_API_KEY" when
  // NVIDIA_API_KEY is the one configured sends you to fix the wrong thing.
  const orKey = process.env.OPENROUTER_API_KEY ?? "";
  const nvKey = process.env.NVIDIA_API_KEY ?? "";
  const key = orKey || nvKey;
  const provider = orKey ? "openrouter" : nvKey ? "nvidia" : null;
  const shapeOk = orKey ? orKey.startsWith("sk-or-") : nvKey.startsWith("nvapi-");

  // Which commit this deployment is actually running. Vercel injects these at
  // build time. Without them a stale deployment is indistinguishable from a
  // fresh one — the site looks fine and simply lacks the newest routes.
  const build = {
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "unknown",
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? "unknown",
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0] ?? null,
    env: process.env.VERCEL_ENV ?? "local",
  };

  const checks = {
    build,
    tutor: {
      provider,
      openrouter_key_set: Boolean(key),
      key_looks_right: shapeOk,
      status: key
        ? shapeOk
          ? "ready"
          : `key is set but does not look like a ${provider} key`
        : "MISSING — Scan, Chat and Voice will not work. Set OPENROUTER_API_KEY or NVIDIA_API_KEY.",
    },
    accounts: {
      configured: CLOUD_ENABLED,
      project: SUPABASE_URL || null,
      source: SUPABASE_FROM_ENV ? "environment variables" : "built-in defaults",
      status: CLOUD_ENABLED
        ? "ready"
        : "not configured — the app runs on-device only, with no sign-in or sync",
    },
    voice: {
      elevenlabs_key_set: Boolean(process.env.ELEVENLABS_API_KEY),
      key_looks_right: (process.env.ELEVENLABS_API_KEY ?? "").startsWith("sk_"),
      status: process.env.ELEVENLABS_API_KEY
        ? (process.env.ELEVENLABS_API_KEY ?? "").startsWith("sk_")
          ? "ready — replies use the ElevenLabs voice"
          : "key is set but does not look like an ElevenLabs key (they start with sk_)"
        : "not set — replies use the device's built-in voice",
    },

    site_url: {
      value: process.env.NEXT_PUBLIC_SITE_URL || null,
      // Sign-in redirects use window.location.origin at runtime, so this is
      // only used for OpenRouter attribution. Optional either way.
      status: process.env.NEXT_PUBLIC_SITE_URL ? "set" : "not set — optional",
    },
    // The real chains, not just whether an override is set. Which model
    // actually answers is the difference between a 1-second reply and a
    // 20-second one, so it is worth being able to read it off the deploy.
    models: {
      text: modelChain(false),
      vision: modelChain(true),
      first: modelChain(false)[0],
      paid_first: !modelChain(false)[0]?.endsWith(":free"),
    },
  };

  // A present key is not a working key: an ElevenLabs key can be valid and
  // still lack the text_to_speech scope, which reads as "ready" here but
  // fails on every actual request. ?probe=1 spends a few characters of quota
  // to find out for certain.
  const wantProbe = new URL(req.url).searchParams.get("probe");

  // Which model ACTUALLY answers, and how fast.
  //
  // "The key is set" and "a fast model replies" are different claims, and the
  // gap between them is the whole difference between a one-second reply and a
  // twenty-second one. With no credit on the account every paid model returns
  // 402, the chain silently falls through to the free tail, and the only
  // symptom is that the app feels slow. This spends one tiny call to say so.
  let tutorProbe: Record<string, unknown> | null = null;
  if (wantProbe && key) {
    const started = Date.now();
    try {
      const r = await complete([{ role: "user", content: "Say OK." }], { maxTokens: 8 });
      const free = r.model.endsWith(":free");
      tutorProbe = {
        ok: true,
        answered_by: r.model,
        ms: Date.now() - started,
        tier: free ? "FREE" : "paid",
        verdict: free
          ? "Fell through to a free model — the paid ones were refused. Almost always means the account has no credit, which is why replies are slow."
          : "A paid model answered. This is the fast path.",
      };
    } catch (e) {
      tutorProbe = { ok: false, error: (e as Error).message };
    }
  }

  let probe: Record<string, unknown> | null = null;
  if (wantProbe && process.env.ELEVENLABS_API_KEY) {
    try {
      const r = await fetch(
        "https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=mp3_44100_128",
        {
          method: "POST",
          headers: {
            "xi-api-key": process.env.ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: "Test.", model_id: "eleven_flash_v2_5" }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (r.ok) {
        probe = { ok: true, status: 200, verdict: "the key really can synthesise speech" };
      } else {
        const d = await r.json().catch(() => null);
        const msg = d?.detail?.message ?? `HTTP ${r.status}`;
        probe = {
          ok: false,
          status: r.status,
          verdict:
            r.status === 401 ? `the key is rejected — ${msg}`
            : r.status === 402 ? "this voice needs a paid plan"
            : r.status === 429 ? "quota reached"
            : msg,
        };
      }
    } catch (e) {
      probe = { ok: false, verdict: `could not reach ElevenLabs — ${(e as Error).message}` };
    }
  }

  const ok = checks.tutor.openrouter_key_set && checks.tutor.key_looks_right;

  return NextResponse.json(
    {
      ok,
      summary: ok ? "Tutoring is configured." : "Tutoring is NOT configured.",
      checks,
      ...(tutorProbe ? { tutor_probe: tutorProbe } : {}),
      ...(probe ? { voice_probe: probe } : {}),
      hint: "Add ?probe=1 to find out which model really answers, and how fast.",
    },
    { status: 200 },
  );
}
