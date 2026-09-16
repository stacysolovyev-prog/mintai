"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evaluate, format } from "@/lib/math";

export default function CalcTab() {
  const [view, setView] = useState<"calc" | "graph">("calc");

  return (
    <>
      <div className="seg">
        <button className={view === "calc" ? "on" : ""} onClick={() => setView("calc")}>Calculator</button>
        <button className={view === "graph" ? "on" : ""} onClick={() => setView("graph")}>Graph</button>
      </div>
      <div className="mt16">{view === "calc" ? <Calculator /> : <Grapher />}</div>
    </>
  );
}

/* ------------------------- calculator ------------------------- */

function Calculator() {
  const [expr, setExpr] = useState("");
  const [deg, setDeg] = useState(true);
  const [sci, setSci] = useState(false);

  const live = useMemo(() => {
    if (!expr.trim()) return "0";
    try {
      return format(evaluate(expr, {}, deg));
    } catch {
      return "";
    }
  }, [expr, deg]);

  const push = (s: string) => setExpr((e) => e + s);

  const equals = () => {
    try {
      setExpr(format(evaluate(expr, {}, deg)));
    } catch {
      /* leave the expression alone so they can fix it */
    }
  };

  const basic = [
    ["AC", "clr"], ["(", "op"], [")", "op"], ["÷", "op"],
    ["7", ""], ["8", ""], ["9", ""], ["×", "op"],
    ["4", ""], ["5", ""], ["6", ""], ["−", "op"],
    ["1", ""], ["2", ""], ["3", ""], ["+", "op"],
    ["0", ""], [".", ""], ["⌫", "op"], ["=", "eq"],
  ] as const;

  const sciKeys = [
    "sin(", "cos(", "tan(", "ln(", "log(",
    "asin(", "acos(", "atan(", "√", "x²",
    "^", "!", "π", "e", "%",
  ];

  const tap = (label: string) => {
    if (label === "AC") return setExpr("");
    if (label === "⌫") return setExpr((e) => e.slice(0, -1));
    if (label === "=") return equals();
    if (label === "×") return push("*");
    if (label === "÷") return push("/");
    if (label === "−") return push("-");
    if (label === "√") return push("sqrt(");
    if (label === "x²") return push("^2");
    if (label === "π") return push("pi");
    push(label);
  };

  return (
    <>
      <div className="readout">
        <div className="expr">{expr || " "}</div>
        <div className="val">{live || "—"}</div>
      </div>

      <div className="row mt12" style={{ gap: 8 }}>
        <button className={`chip ${deg ? "on" : ""}`} onClick={() => setDeg(true)}>DEG</button>
        <button className={`chip ${!deg ? "on" : ""}`} onClick={() => setDeg(false)}>RAD</button>
        <span className="grow" />
        <button className={`chip ${sci ? "on" : ""}`} onClick={() => setSci((s) => !s)}>
          {sci ? "Hide" : "Functions"}
        </button>
      </div>

      {sci && (
        <div className="keys sci mt12">
          {sciKeys.map((k) => (
            <button key={k} className="key fn" onClick={() => tap(k)}>{k.replace("(", "")}</button>
          ))}
        </div>
      )}

      <div className="keys mt12">
        {basic.map(([label, kind]) => (
          <button key={label} className={`key ${kind}`} onClick={() => tap(label)}>
            {label}
          </button>
        ))}
      </div>

      <p className="tiny muted mt12 center">
        Type-friendly too: 2(3+4), 2x and sin30 all work.
      </p>
    </>
  );
}

/* --------------------------- grapher --------------------------- */

function Grapher() {
  const [input, setInput] = useState("x^2 - 3");
  const [span, setSpan] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const ratio = h / w;
    const xMin = -span, xMax = span;
    const yMin = -span * ratio, yMax = span * ratio;

    const px = (x: number) => ((x - xMin) / (xMax - xMin)) * w;
    const py = (y: number) => h - ((y - yMin) / (yMax - yMin)) * h;

    // grid
    const step = niceStep(span);
    // Canvas takes no CSS variables, so these mirror the ink tokens.
    ctx.strokeStyle = "rgba(13,26,22,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) {
      ctx.moveTo(px(x), 0); ctx.lineTo(px(x), h);
    }
    for (let y = Math.ceil(yMin / step) * step; y <= yMax; y += step) {
      ctx.moveTo(0, py(y)); ctx.lineTo(w, py(y));
    }
    ctx.stroke();

    // axes
    ctx.strokeStyle = "rgba(13,26,22,0.32)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, py(0)); ctx.lineTo(w, py(0));
    ctx.moveTo(px(0), 0); ctx.lineTo(px(0), h);
    ctx.stroke();

    // axis numbers
    ctx.fillStyle = "rgba(13,26,22,0.45)";
    ctx.font = "11px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) {
      if (Math.abs(x) < 1e-9) continue;
      ctx.fillText(trim(x), px(x), py(0) + 4);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let y = Math.ceil(yMin / step) * step; y <= yMax; y += step) {
      if (Math.abs(y) < 1e-9) continue;
      ctx.fillText(trim(y), px(0) - 5, py(y));
    }

    // curve
    const src = input.replace(/^\s*y\s*=\s*/i, "").trim();
    if (!src) { setError(null); return; }

    ctx.strokeStyle = "#12795F";
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.beginPath();

    let drawing = false;
    let prevY = 0;
    let bad = 0;
    const N = Math.floor(w * 2);

    for (let i = 0; i <= N; i++) {
      const x = xMin + ((xMax - xMin) * i) / N;
      let y: number;
      try {
        y = evaluate(src, { x }, false);
      } catch {
        bad++;
        if (bad > 3) { setError("Can't read that function."); return; }
        drawing = false;
        continue;
      }

      if (!Number.isFinite(y) || y < yMin - span * 40 || y > yMax + span * 40) {
        drawing = false;
        continue;
      }

      // Break the line across asymptotes instead of drawing a vertical spike.
      if (drawing && Math.abs(y - prevY) > (yMax - yMin) * 1.6) drawing = false;

      if (drawing) ctx.lineTo(px(x), py(y));
      else { ctx.moveTo(px(x), py(y)); drawing = true; }

      prevY = y;
    }

    ctx.stroke();
    setError(null);
  }, [input, span]);

  useEffect(() => {
    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  return (
    <>
      <label className="field">
        <span>Function</span>
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="y = x^2 - 3"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>

      <div className="card mt12" style={{ padding: 10 }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: 300, display: "block", borderRadius: 14 }}
        />
      </div>

      {error && <p className="small mt8" style={{ color: "var(--red)" }}>{error}</p>}

      <div className="row mt12" style={{ gap: 8 }}>
        <button className="btn sm secondary grow" onClick={() => setSpan((s) => Math.min(s * 2, 1000))}>
          Zoom out
        </button>
        <button className="btn sm secondary grow" onClick={() => setSpan((s) => Math.max(s / 2, 0.5))}>
          Zoom in
        </button>
        <button className="btn sm ghost" onClick={() => setSpan(10)}>Reset</button>
      </div>

      <div className="row wrap mt12" style={{ gap: 7 }}>
        {["x^2 - 3", "sin(x)", "1/x", "2^x", "sqrt(x)", "x^3 - 2x"].map((f) => (
          <button key={f} className="chip" onClick={() => setInput(f)}>{f}</button>
        ))}
      </div>
    </>
  );
}

function niceStep(span: number): number {
  const raw = (span * 2) / 10;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
}

function trim(n: number): string {
  return String(Number(n.toPrecision(6)));
}
