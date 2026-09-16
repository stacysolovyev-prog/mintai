"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./Icons";
import { haptic } from "@/lib/haptics";

/**
 * The weather room. A hidden mode behind seven taps on "Your stats".
 *
 * Everything here runs on the device: a 2D particle simulation, no model and
 * no API key. It can optionally pull the CURRENT conditions where you are from
 * Open-Meteo, which is free and needs no key at all, and set the simulation to
 * match — so the thing on screen is the weather outside your window.
 *
 * The simulation state lives in refs, not React state. A rAF loop that wrote to
 * state would re-render the tree sixty times a second for an animation the
 * canvas is already handling.
 */

export type Condition = "clear" | "cloudy" | "rain" | "storm" | "snow" | "fog";

const CONDITIONS: { id: Condition; label: string }[] = [
  { id: "clear",  label: "Clear" },
  { id: "cloudy", label: "Cloudy" },
  { id: "rain",   label: "Rain" },
  { id: "storm",  label: "Storm" },
  { id: "snow",   label: "Snow" },
  { id: "fog",    label: "Fog" },
];

/** WMO weather codes, as returned by Open-Meteo, folded into what we can draw. */
function fromWmo(code: number): Condition {
  if (code === 0 || code === 1) return "clear";
  if (code === 2 || code === 3) return "cloudy";
  if (code >= 45 && code <= 48) return "fog";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 85 && code <= 86) return "snow";
  if (code >= 95) return "storm";
  if (code >= 51) return "rain";  // drizzle, rain, freezing rain, showers
  return "cloudy";
}

type Drop = { x: number; y: number; len: number; v: number };
type Flake = { x: number; y: number; r: number; v: number; sway: number; phase: number };
type Cloud = { x: number; y: number; s: number; v: number; a: number };
type Star = { x: number; y: number; r: number; tw: number };
type Splash = { x: number; y: number; life: number };

/** Sky colours, top then bottom, per condition and time of day. */
const SKY: Record<Condition, { day: [string, string]; night: [string, string] }> = {
  clear:  { day: ["#4FA3E3", "#BFE4F7"], night: ["#060B1C", "#141F3D"] },
  cloudy: { day: ["#8CA3B4", "#CBD6DE"], night: ["#0C1220", "#1B2435"] },
  rain:   { day: ["#5C6B78", "#93A3AE"], night: ["#080D16", "#151D28"] },
  storm:  { day: ["#39434E", "#5E6B77"], night: ["#04070C", "#0E141C"] },
  snow:   { day: ["#8D9BAA", "#D6DEE6"], night: ["#0A0F1A", "#1A2330"] },
  fog:    { day: ["#9AA5AC", "#C8CFD4"], night: ["#0B0F13", "#191F25"] },
};

export default function Weather({ onClose }: { onClose: () => void }) {
  const [condition, setCondition] = useState<Condition>("rain");
  const [night, setNight] = useState(false);
  const [wind, setWind] = useState(0.35);
  const [place, setPlace] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locErr, setLocErr] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Live values for the animation loop, so changing a control does not restart it.
  const sim = useRef({ condition, night, wind });
  sim.current = { condition, night, wind };

  useEffect(() => setMounted(true), []);

  // Lock the page behind the overlay, and let Escape out.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  /** Current conditions where you are. Open-Meteo is free and takes no key. */
  const useRealWeather = useCallback(async () => {
    haptic("tap");
    setLocErr(null);

    if (!navigator.geolocation) {
      setLocErr("This device won't share a location.");
      return;
    }
    setLocating(true);

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 8000,
          maximumAge: 300_000,
        }),
      );

      const { latitude: la, longitude: lo } = pos.coords;
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${la.toFixed(3)}` +
          `&longitude=${lo.toFixed(3)}` +
          `&current=temperature_2m,weather_code,wind_speed_10m,is_day`,
      );
      if (!res.ok) throw new Error(String(res.status));

      const data = await res.json();
      const cur = data?.current;
      if (!cur) throw new Error("no reading");

      setCondition(fromWmo(Number(cur.weather_code)));
      setNight(Number(cur.is_day) === 0);
      // km/h into the 0..1 the simulation uses. 40km/h is a gale on screen.
      setWind(Math.max(0, Math.min(1, Number(cur.wind_speed_10m) / 40)));
      setPlace(`${Math.round(Number(cur.temperature_2m))}° where you are`);
      haptic("success");
    } catch (e) {
      setLocErr(
        (e as GeolocationPositionError)?.code === 1
          ? "Location was blocked. Pick a condition instead."
          : "Couldn't read the weather. Pick a condition instead.",
      );
      haptic("error");
    } finally {
      setLocating(false);
    }
  }, []);

  // The simulation.
  //
  // This depends on `mounted`. The canvas only exists after the portal renders,
  // so an effect that ran once on first render would find no canvas, bail, and
  // never retry — leaving a 300x150 default backing store and a blank overlay.
  useEffect(() => {
    if (!mounted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let w = 0;
    let h = 0;
    let dpr = 1;

    const drops: Drop[] = [];
    const flakes: Flake[] = [];
    const clouds: Cloud[] = [];
    const stars: Star[] = [];
    const splashes: Splash[] = [];

    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Population scales with area so a tablet is not sparser than a phone.
      const area = (w * h) / (390 * 800);

      drops.length = 0;
      for (let i = 0; i < Math.round(340 * area); i++)
        drops.push({ x: rand(-w * 0.3, w * 1.3), y: rand(0, h), len: rand(9, 26), v: rand(7, 15) });

      flakes.length = 0;
      for (let i = 0; i < Math.round(170 * area); i++)
        flakes.push({
          x: rand(0, w), y: rand(0, h), r: rand(1, 3.2),
          v: rand(0.5, 1.7), sway: rand(0.4, 1.4), phase: rand(0, Math.PI * 2),
        });

      clouds.length = 0;
      for (let i = 0; i < Math.round(7 * Math.max(1, area * 0.8)); i++)
        clouds.push({
          x: rand(-0.2, 1.2) * w, y: rand(0.04, 0.45) * h,
          s: rand(0.5, 1.5), v: rand(0.04, 0.16), a: rand(0.25, 0.7),
        });

      stars.length = 0;
      for (let i = 0; i < Math.round(90 * area); i++)
        stars.push({ x: rand(0, w), y: rand(0, h * 0.7), r: rand(0.4, 1.5), tw: rand(0, Math.PI * 2) });
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let flash = 0;        // lightning brightness, 0..1
    let nextBolt = 90;    // frames until the next strike
    let bolt: { x: number; y: number }[] = [];
    let t = 0;
    let raf = 0;

    const drawCloud = (c: Cloud, tint: string, alpha: number) => {
      ctx.fillStyle = tint;
      ctx.globalAlpha = alpha * c.a;
      const r = 26 * c.s;
      // A cloud is five overlapping discs; cheaper than a texture and it reads.
      for (const [dx, dy, rr] of [[0, 0, 1], [r * 0.9, r * 0.15, 0.78], [-r * 0.95, r * 0.2, 0.72], [r * 0.4, -r * 0.45, 0.66], [-r * 0.4, -r * 0.35, 0.6]] as const) {
        ctx.beginPath();
        ctx.arc(c.x + dx, c.y + dy, r * rr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const frame = () => {
      const { condition: cond, night: isNight, wind: windNow } = sim.current;
      t += 1;

      // Sky
      const [top, bottom] = SKY[cond][isNight ? "night" : "day"];
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, top);
      sky.addColorStop(1, bottom);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Stars, only when it is night and the sky is not solid cloud.
      if (isNight && (cond === "clear" || cond === "cloudy")) {
        for (const s of stars) {
          const a = 0.35 + 0.45 * Math.sin(t * 0.02 + s.tw);
          ctx.globalAlpha = Math.max(0, a);
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Sun or moon, clear skies only.
      if (cond === "clear") {
        const cx = w * 0.76;
        const cy = h * 0.2;
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 120);
        if (isNight) {
          glow.addColorStop(0, "rgba(226,232,240,0.95)");
          glow.addColorStop(0.18, "rgba(226,232,240,0.35)");
        } else {
          glow.addColorStop(0, "rgba(255,238,170,1)");
          glow.addColorStop(0.16, "rgba(255,224,130,0.55)");
        }
        glow.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(cx - 130, cy - 130, 260, 260);
      }

      // Clouds
      if (cond !== "clear") {
        const tint = isNight ? "#2a3444" : cond === "storm" ? "#3a444f" : "#ffffff";
        const alpha = cond === "fog" ? 0.5 : cond === "storm" ? 0.9 : 0.75;
        for (const c of clouds) {
          if (!still) c.x += c.v * (0.4 + windNow * 3);
          if (c.x - 90 * c.s > w) c.x = -90 * c.s;
          drawCloud(c, tint, alpha);
        }
      }

      // Precipitation
      const heavy = cond === "storm";
      if (cond === "rain" || heavy) {
        ctx.strokeStyle = isNight ? "rgba(170,195,225,0.55)" : "rgba(225,240,255,0.65)";
        ctx.lineWidth = heavy ? 1.6 : 1.2;
        ctx.beginPath();
        const drift = windNow * 14;
        const count = heavy ? drops.length : Math.round(drops.length * 0.62);
        for (let i = 0; i < count; i++) {
          const d = drops[i];
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x + drift * (d.len / 22), d.y + d.len);
          if (!still) {
            d.y += d.v * (heavy ? 1.5 : 1);
            d.x += drift * 0.14;
            if (d.y > h) {
              // A drop that lands leaves a ring on the ground.
              if (Math.random() < 0.28) splashes.push({ x: d.x, y: h - rand(0, 10), life: 1 });
              d.y = rand(-40, -2);
              d.x = rand(-w * 0.3, w * 1.3);
            }
            if (d.x > w * 1.35) d.x = -w * 0.3;
          }
        }
        ctx.stroke();

        ctx.strokeStyle = isNight ? "rgba(170,195,225,0.4)" : "rgba(235,245,255,0.5)";
        ctx.lineWidth = 1;
        for (let i = splashes.length - 1; i >= 0; i--) {
          const s = splashes[i];
          ctx.globalAlpha = s.life;
          ctx.beginPath();
          ctx.ellipse(s.x, s.y, (1 - s.life) * 11, (1 - s.life) * 3.4, 0, 0, Math.PI * 2);
          ctx.stroke();
          if (!still) s.life -= 0.05;
          if (s.life <= 0) splashes.splice(i, 1);
        }
        ctx.globalAlpha = 1;
      }

      if (cond === "snow") {
        ctx.fillStyle = isNight ? "rgba(226,238,255,0.85)" : "rgba(255,255,255,0.95)";
        for (const f of flakes) {
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          ctx.fill();
          if (!still) {
            f.y += f.v;
            f.phase += 0.02;
            // Snow does not fall straight; it wanders.
            f.x += Math.sin(f.phase) * f.sway + windNow * 2.4;
            if (f.y > h + 4) { f.y = -4; f.x = rand(0, w); }
            if (f.x > w + 4) f.x = -4;
            if (f.x < -4) f.x = w + 4;
          }
        }
      }

      // Fog banks, drifting at different speeds so it has depth.
      if (cond === "fog") {
        for (let i = 0; i < 5; i++) {
          const y = h * (0.35 + i * 0.13);
          const off = ((t * (0.25 + i * 0.16) * (0.4 + windNow * 2)) % (w + 400)) - 200;
          const g = ctx.createLinearGradient(off - 200, 0, off + 200, 0);
          const c = isNight ? "255,255,255" : "255,255,255";
          g.addColorStop(0, `rgba(${c},0)`);
          g.addColorStop(0.5, `rgba(${c},${isNight ? 0.1 : 0.22})`);
          g.addColorStop(1, `rgba(${c},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(0, y - 46, w, 92);
        }
      }

      // Lightning
      if (heavy) {
        if (!still && --nextBolt <= 0) {
          flash = 1;
          nextBolt = Math.round(rand(70, 200));
          // Build a jagged path once per strike and hold it while it flashes.
          bolt = [{ x: rand(w * 0.2, w * 0.8), y: 0 }];
          while (bolt[bolt.length - 1].y < h * 0.62) {
            const p = bolt[bolt.length - 1];
            bolt.push({ x: p.x + rand(-26, 26), y: p.y + rand(18, 46) });
          }
        }
        if (flash > 0) {
          ctx.fillStyle = `rgba(226,240,255,${flash * 0.5})`;
          ctx.fillRect(0, 0, w, h);

          ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, flash * 1.6)})`;
          ctx.lineWidth = 2.4;
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(bolt[0].x, bolt[0].y);
          for (const p of bolt) ctx.lineTo(p.x, p.y);
          ctx.stroke();

          if (!still) flash -= 0.055;
        }
      }

      // Ground haze, so the bottom of the frame is not a hard cut.
      const floor = ctx.createLinearGradient(0, h - 90, 0, h);
      floor.addColorStop(0, "rgba(0,0,0,0)");
      floor.addColorStop(1, isNight ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.18)");
      ctx.fillStyle = floor;
      ctx.fillRect(0, h - 90, w, 90);

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div className="wx" role="dialog" aria-label="Weather" aria-modal="true">
      <canvas ref={canvasRef} className="wx-canvas" />

      <button className="vf-close wx-close" onClick={onClose} aria-label="Close weather">
        <CloseIcon />
      </button>

      <div className="wx-panel">
        {place && <p className="wx-place">{place}</p>}
        {locErr && <p className="wx-err">{locErr}</p>}

        <div className="wx-chips">
          {CONDITIONS.map((c) => (
            <button
              key={c.id}
              className={`wx-chip ${condition === c.id ? "on" : ""}`}
              onClick={() => {
                haptic("tap");
                setCondition(c.id);
                setPlace(null);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="wx-row">
          <label className="wx-wind">
            <span>Wind</span>
            <input
              type="range" min={0} max={1} step={0.01} value={wind}
              onChange={(e) => setWind(Number(e.target.value))}
              aria-label="Wind strength"
            />
          </label>

          <button
            className={`wx-chip ${night ? "on" : ""}`}
            onClick={() => { haptic("tap"); setNight((n) => !n); }}
          >
            {night ? "Night" : "Day"}
          </button>
        </div>

        <button className="wx-real" onClick={useRealWeather} disabled={locating}>
          {locating ? "Reading the sky…" : "Use the weather where I am"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
