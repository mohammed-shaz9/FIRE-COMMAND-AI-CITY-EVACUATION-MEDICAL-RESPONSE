import {
  Fragment, memo, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from "react";
import { Brain, Check, Radar, Route as RouteIcon, Siren } from "lucide-react";
import {
  AGENTS, CELLS, DOTS, ENVELOPE, ROOMS, ROUTES, SENSOR, STEPS, TOTAL, WALLS,
  cellState, clamp, derive, dotT, fireAt, railAt, routeDraw, type Snap,
} from "./storyModel";

// Scroll-driven pinned story. Mount: <ScrollStory /> (needs no overflow:hidden ancestor, sticky is used).

const ICONS = [Radar, Brain, RouteIcon, Siren];
const mq = "(prefers-reduced-motion: reduce)";
const useReducedMotion = () =>
  useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(mq);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(mq).matches,
    () => false,
  );

const Cell = memo(function Cell({ x, y, d, s }: { x: number; y: number; d: number; s: number }) {
  return (
    <rect x={x + 1} y={y + 1} width={18} height={18} rx={3}
      className={`ff-cell ff-c${s}`} style={{ "--d": `${d}s` } as CSSProperties} />
  );
});

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function hud(s: Snap): [string, string] {
  switch (s.step) {
    case 0: return [`SENSOR C-07 · ${s.temp}°C · ${s.temp >= 50 ? "ALERT" : "NOMINAL"}`, s.temp >= 50 ? "#ff003c" : "#0dccf2"];
    case 1: return [`FIRE FRONT · ${s.lit}/${CELLS.length} CELLS · ${s.temp}°C`, "#ff9900"];
    case 2: return [`AGENTS ENGAGED · ${s.chars.filter((c, i) => c >= AGENTS[i].log.length).length}/4 DONE`, "#0dccf2"];
    case 3: return [`EVACUATING · ${s.evac}/${TOTAL}`, "#00ffaa"];
    default: return [`ALL CLEAR · ${s.evac}/${TOTAL}`, "#00ffaa"];
  }
}

export default function ScrollStory() {
  const reduced = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<Snap>(() => derive(0));

  useLayoutEffect(() => {
    const section = sectionRef.current!, stage = stageRef.current!;
    const routeEls = [...stage.querySelectorAll<SVGPathElement>("[data-route]")];
    const mains = [...stage.querySelectorAll<SVGPathElement>("[data-main]")];
    const lens = mains.map((m) => m.getTotalLength());
    const dots = [...stage.querySelectorAll<SVGCircleElement>("[data-dot]")];

    const apply = (p: number) => {
      const st = stage.style;
      st.setProperty("--f", fireAt(p).toFixed(3));
      st.setProperty("--safe", clamp((p - 0.6) / 0.25).toFixed(3));
      st.setProperty("--rail", railAt(p).toFixed(4));
      for (const el of routeEls) el.style.strokeDashoffset = String(1 - routeDraw(p, +el.dataset.route!));
      for (const el of dots) {
        const r = +el.dataset.r!, t = dotT(p, +el.dataset.d!), j = el.dataset.j === "1" ? 7 : 0;
        const pt = mains[r].getPointAtLength(t * lens[r]);
        el.setAttribute("transform", `translate(${(pt.x + j).toFixed(1)} ${(pt.y + j * 0.8).toFixed(1)})`);
        el.style.opacity = t >= 1 ? "0" : "1";
      }
      const n = derive(p);
      setSnap((prev) => (prev.key === n.key ? prev : n));
    };

    if (reduced) { apply(1); return; }

    let raf = 0, on = false;
    const read = () => {
      raf = 0;
      const r = section.getBoundingClientRect();
      const span = r.height - stage.clientHeight;
      apply(span > 0 ? clamp(-r.top / span) : 0);
    };
    const tick = () => { if (!raf) raf = requestAnimationFrame(read); };
    const attach = (v: boolean) => {
      if (v === on) return;
      on = v;
      stage.dataset.live = v ? "1" : "0";
      const f = v ? "addEventListener" : "removeEventListener";
      window[f]("scroll", tick, { passive: true });
      window[f]("resize", tick);
      if (v) tick(); else { cancelAnimationFrame(raf); raf = 0; }
    };
    read();
    const io = new IntersectionObserver(([e]) => attach(e.isIntersecting), { rootMargin: "100px 0px" });
    io.observe(section);
    return () => { io.disconnect(); attach(false); };
  }, [reduced]);

  const { step } = snap;
  const [hudText, hudColor] = hud(snap);
  const fq = snap.fq;
  const done = (i: number) => snap.chars[i] >= AGENTS[i].log.length;
  const rail = ["Detect", "Spread", "Decide", "Route", "Clear"];

  return (
    <section
      ref={sectionRef}
      aria-labelledby="ff-story-title"
      data-static={reduced ? "1" : "0"}
      className="ff-story relative w-full text-slate-100"
    >
      <style>{CSS}</style>
      <div
        ref={stageRef}
        data-live="0"
        className={`ff-stage relative isolate overflow-hidden bg-[#020617] ${reduced ? "py-10" : "sticky top-0 h-[100svh] pt-16"}`}
      >
        <div aria-hidden className="ff-amb-fire pointer-events-none absolute inset-0 -z-10" />
        <div aria-hidden className="ff-amb-safe pointer-events-none absolute inset-0 -z-10" />

        <div
          className={`mx-auto grid w-full max-w-6xl gap-3 px-4 py-3 sm:px-6 sm:py-5 lg:gap-x-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] ${
            reduced ? "lg:grid-rows-[auto_auto_auto]" : "h-full grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] lg:grid-rows-[auto_minmax(0,1fr)_auto]"
          }`}
        >
          {/* head */}
          <header className="lg:col-start-1 lg:row-start-1">
            <p className="ff-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#ff9900] sm:text-xs">
              FireCommand · incident timeline
            </p>
            <h2 id="ff-story-title" className="ff-display mt-1 text-[1.15rem] font-black leading-tight sm:text-3xl lg:text-4xl">
              From first spark to <span className="text-[#00ffaa]">safe evacuation</span>
            </h2>
          </header>

          {/* progress rail */}
          <nav aria-label="Story progress" className="lg:col-start-1 lg:row-start-3 lg:self-end">
            <div className="relative">
              <div aria-hidden className="absolute inset-x-3.5 top-[13px] h-0.5 overflow-hidden rounded bg-white/10">
                <div className="ff-rail-fill h-full w-full" />
              </div>
              <ol className="relative flex justify-between">
                {rail.map((name, i) => (
                  <li key={name} aria-current={i === step ? "step" : undefined} className="flex w-14 flex-col items-center gap-1">
                    <span
                      className="ff-node ff-mono flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold"
                      data-s={i < step ? "done" : i === step ? "on" : "off"}
                      data-k={i >= 3 ? "safe" : i === 2 ? "ai" : "fire"}
                    >
                      {i < step ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                    </span>
                    <span className={`hidden text-[10px] font-semibold uppercase tracking-wider sm:block ${i === step ? "text-slate-100" : "text-slate-500"}`}>
                      {name}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </nav>

          {/* stage */}
          <div className={`relative lg:col-start-2 lg:row-span-2 lg:row-start-1 ${reduced ? "" : "min-h-[190px] lg:min-h-0"}`}>
            <div
              className="ff-mono absolute left-2 top-2 z-10 flex items-center gap-2 rounded-md border bg-black/60 px-2.5 py-1 text-[10px] font-semibold tracking-wider backdrop-blur sm:text-[11px]"
              style={{ borderColor: `${hudColor}66`, color: hudColor }}
            >
              <span className="ff-blink h-1.5 w-1.5 rounded-full" style={{ background: hudColor }} />
              {hudText}
            </div>
            <svg
              viewBox="0 0 800 500"
              role="img"
              aria-labelledby="ff-svg-t ff-svg-d"
              className={reduced ? "block h-auto w-full" : "absolute inset-0 h-full w-full"}
            >
              <title id="ff-svg-t">Floor plan evacuation simulation</title>
              <desc id="ff-svg-d">
                A fire starts in Lab C, spreads through neighbouring rooms and the corridor, then AI-planned routes lead occupants around the fire to the west and east exits.
              </desc>
              <defs>
                <pattern id="ff-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M20 0H0V20" fill="none" stroke="#0dccf2" strokeOpacity="0.07" />
                </pattern>
                <radialGradient id="ff-heat">
                  <stop offset="0" stopColor="#ff6a00" stopOpacity="0.55" />
                  <stop offset="1" stopColor="#ff003c" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* floors */}
              <rect x="40" y="40" width="720" height="420" rx="6" fill="#050e20" />
              <rect x="40" y="200" width="720" height="100" fill="#08172c" />
              <rect x="40" y="40" width="720" height="420" rx="6" fill="url(#ff-grid)" />
              {ROOMS.map((r) => (
                <text key={r.label} x={r.x + 10} y={r.y + 20} className="ff-mono" fontSize="11" letterSpacing="2" fill="#4b6a8f" aria-hidden>
                  {r.label}
                </text>
              ))}

              {/* predicted spread zone (Predict agent) */}
              <rect
                x={ENVELOPE.x} y={ENVELOPE.y} width={ENVELOPE.w} height={ENVELOPE.h} rx="14"
                fill="none" stroke="#ff9900" strokeWidth="1.5" strokeDasharray="7 6"
                className="ff-env" data-on={snap.chars[1] > 0 && step < 4 ? 1 : 0}
              />

              {/* fire */}
              <g className="ff-fire" data-dim={step >= 4 ? 1 : 0}>
                <g className="ff-heat"><circle r="70" fill="url(#ff-heat)" /></g>
                {CELLS.map((c) => (
                  <Cell key={`${c.x}-${c.y}`} x={c.x} y={c.y} d={c.d} s={cellState(fq, c.t)} />
                ))}
              </g>

              {/* walls + exits */}
              <path d={WALLS} fill="none" stroke="#2a4a73" strokeWidth="2.5" strokeLinecap="square" />
              <rect x="40" y="40" width="720" height="420" rx="6" fill="none" stroke="#2f5585" strokeWidth="3.5" />
              {[40, 760].map((x, i) => (
                <g key={x}>
                  <path d={`M${x} 230V270`} stroke="#00ffaa" strokeWidth="6" className="ff-exit" data-on={step >= 3 ? 1 : 0} />
                  <text transform={`translate(${i ? 782 : 18} 250) rotate(${i ? 90 : -90})`} textAnchor="middle" dominantBaseline="middle"
                    className="ff-mono ff-exit" data-on={step >= 3 ? 1 : 0} fontSize="11" fontWeight="700" letterSpacing="3" fill="#00ffaa" aria-hidden>
                    EXIT
                  </text>
                </g>
              ))}

              {/* routes: planned track, glow, drawing line */}
              {ROUTES.map((d, i) => (
                <g key={i} fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d={d} stroke="#0dccf2" strokeOpacity="0.18" strokeWidth="2" strokeDasharray="3 7" />
                  <path d={d} pathLength={1} strokeDasharray={1} strokeDashoffset={1} data-route={i} stroke="#00ffaa" strokeOpacity="0.16" strokeWidth="9" />
                  <path d={d} pathLength={1} strokeDasharray={1} strokeDashoffset={1} data-route={i} data-main="" stroke="#00ffaa" strokeWidth="3" />
                </g>
              ))}

              {/* sensors */}
              {[[130, 70], [310, 70], [670, 70], [130, 430], [310, 430], [490, 430], [670, 430]].map(([x, y]) => (
                <circle key={`${x}${y}`} cx={x} cy={y} r="2.5" fill="#0dccf2" opacity="0.45" />
              ))}
              <g transform={`translate(${SENSOR.x} ${SENSOR.y})`}>
                {[0, 0.6, 1.2].map((dl) => (
                  <circle key={dl} r="14" fill="none" stroke="#ff003c" strokeWidth="2" className="ff-ring"
                    style={{ animationDelay: `${dl}s` }} data-on={snap.temp >= 50 && step < 3 ? 1 : 0} />
                ))}
                <circle r="5" fill={snap.temp >= 50 ? "#ff003c" : "#0dccf2"} stroke="#fff" strokeWidth="1.5" />
              </g>

              {/* people */}
              <g className="ff-people" data-go={step >= 3 ? 1 : 0}>
                {DOTS.map((d) => (
                  <circle key={`${d.r}-${d.j}`} r="4" data-dot="" data-r={d.r} data-j={d.j} data-d={d.d}
                    className="ff-dot" />
                ))}
              </g>

              {/* all clear */}
              <g className="ff-clear" data-on={step >= 4 ? 1 : 0}>
                <rect x="-96" y="-26" width="192" height="52" rx="26" fill="#020617" fillOpacity="0.92" stroke="#00ffaa" strokeWidth="2" />
                <circle cx="-66" r="13" fill="#00ffaa" />
                <path d="M-72 0L-67 5L-59 -5" fill="none" stroke="#020617" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <text x="-42" y="1" dominantBaseline="middle" className="ff-display" fontSize="20" fontWeight="800" letterSpacing="1.5" fill="#00ffaa">
                  ALL CLEAR
                </text>
              </g>
            </svg>
          </div>

          {/* captions */}
          <ol aria-label="Story steps" className={`lg:col-start-1 lg:row-start-2 ${reduced ? "space-y-5" : "grid content-start"}`}>
            {STEPS.map((s, i) => (
              <li
                key={s.tag}
                aria-current={i === step ? "step" : undefined}
                className="ff-cap col-start-1 row-start-1"
                data-pos={reduced ? "on" : i < step ? "past" : i > step ? "next" : "on"}
              >
                <p className="ff-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#0dccf2] sm:text-xs">
                  {String(i + 1).padStart(2, "0")} / 05 · {s.tag}
                </p>
                <h3 className="ff-display mt-1 text-lg font-extrabold leading-snug sm:text-2xl lg:text-3xl">{s.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-300 sm:mt-2 sm:text-base">{s.body}</p>
                {i === 4 && (
                  <>
                    <dl className="ff-mono mt-3 grid grid-cols-3 gap-2 text-center">
                      {[
                        ["Evacuated", `${snap.evac}/${TOTAL}`],
                        ["ETA saved", fmt(snap.eta)],
                        ["Casualties", "0"],
                      ].map(([k, v]) => (
                        <div key={k} className="rounded-md border border-[#00ffaa]/30 bg-[#00ffaa]/5 px-1 py-1.5">
                          <dd className="text-sm font-bold tabular-nums text-[#00ffaa] sm:text-lg">{v}</dd>
                          <dt className="text-[9px] uppercase tracking-wider text-slate-400 sm:text-[10px]">{k}</dt>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-1 text-[10px] text-slate-500">Simulated scenario.</p>
                  </>
                )}
              </li>
            ))}
          </ol>

          {/* agent pipeline + log */}
          <div className="lg:col-start-2 lg:row-start-3">
            <div role="group" aria-label="AI agent pipeline" className="flex items-center">
              {AGENTS.map((a, i) => {
                const Icon = ICONS[i];
                const st = done(i) ? "done" : snap.chars[i] > 0 ? "on" : "off";
                return (
                  <Fragment key={a.name}>
                    <div className="ff-agent ff-mono flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border px-1.5 py-1.5 text-[10px] font-bold uppercase tracking-wider sm:text-[11px]"
                      data-s={st} data-safe={step >= 4 ? 1 : 0}>
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{a.name}</span>
                    </div>
                    {i < 3 && (
                      <span aria-hidden className="relative h-0.5 w-3 shrink-0 overflow-hidden bg-white/10 sm:w-6">
                        <span className="ff-conn absolute inset-0" data-on={done(i) ? 1 : 0} />
                      </span>
                    )}
                  </Fragment>
                );
              })}
            </div>
            <div aria-label="Agent log" className="ff-mono mt-2 rounded-md border border-white/10 bg-black/50 px-3 py-2 text-[10.5px] leading-5 sm:text-[11px]">
              {AGENTS.map((a, i) => (
                <p key={a.name} className="grid grid-cols-[4.6rem_minmax(0,1fr)] gap-x-1 transition-opacity duration-300" style={{ opacity: snap.chars[i] > 0 ? 1 : 0.25 }}>
                  <span className="uppercase text-[#0dccf2]">{a.name} ›</span>
                  <span className="grid">
                    <span className="sr-only">{a.log}</span>
                    <span aria-hidden className="invisible col-start-1 row-start-1">{a.log}</span>
                    <span aria-hidden className="col-start-1 row-start-1 text-slate-200">
                      {a.log.slice(0, snap.chars[i])}
                      {snap.chars[i] > 0 && snap.chars[i] < a.log.length && <span className="ff-caret">▍</span>}
                    </span>
                  </span>
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const CSS = `
.ff-story{height:500vh;height:500svh;--ff-display:var(--font-display,'Space Grotesk','Inter',system-ui,sans-serif);--ff-mono:var(--font-mono,'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace)}
.ff-story[data-static="1"]{height:auto}
.ff-display{font-family:var(--ff-display)}.ff-mono{font-family:var(--ff-mono)}
.ff-amb-fire{background:radial-gradient(60% 50% at 70% 45%,rgba(255,80,0,.22),transparent 70%);opacity:calc(var(--f,0)*(1 - var(--safe,0)))}
.ff-amb-safe{background:radial-gradient(60% 50% at 70% 45%,rgba(0,255,170,.14),transparent 70%);opacity:var(--safe,0)}
.ff-rail-fill{background:linear-gradient(90deg,#ff6a00,#0dccf2 55%,#00ffaa);transform:translateX(calc((var(--rail,0) - 1)*100%));will-change:transform}
.ff-node{border-color:rgba(255,255,255,.15);background:#020617;color:#64748b;transition:background .3s,border-color .3s,color .3s}
.ff-node[data-s="on"]{color:#020617;background:#ff9900;border-color:#ff9900}
.ff-node[data-s="on"][data-k="ai"]{background:#0dccf2;border-color:#0dccf2}
.ff-node[data-s="on"][data-k="safe"],.ff-node[data-s="done"][data-k="safe"]{background:#00ffaa;border-color:#00ffaa;color:#020617}
.ff-node[data-s="done"]{border-color:#0dccf2;color:#0dccf2}
.ff-cap{transition:opacity .5s ease,transform .5s ease}
.ff-cap[data-pos="past"]{opacity:0;transform:translateY(-16px);pointer-events:none}
.ff-cap[data-pos="next"]{opacity:0;transform:translateY(16px);pointer-events:none}
.ff-agent{border-color:rgba(255,255,255,.1);color:#64748b;transition:border-color .3s,background .3s,color .3s}
.ff-agent[data-s="on"]{border-color:rgba(255,153,0,.7);background:rgba(255,153,0,.1);color:#ffb84d;animation:ff-glow 1s ease-in-out infinite alternate}
.ff-agent[data-s="done"]{border-color:rgba(13,204,242,.6);background:rgba(13,204,242,.1);color:#0dccf2}
.ff-agent[data-safe="1"]{border-color:rgba(0,255,170,.6);background:rgba(0,255,170,.08);color:#00ffaa}
.ff-conn{background:#0dccf2;transform:translateX(-100%);transition:transform .4s ease}
.ff-conn[data-on="1"]{transform:none}
.ff-caret{animation:ff-blink 1s steps(2) infinite}
.ff-blink{animation:ff-blink 1.2s ease-in-out infinite}
.ff-cell{transition:opacity .35s ease,fill .35s ease;opacity:0}
.ff-c1{fill:#fff1b8;opacity:1}
.ff-c2{fill:#ff8a1f;opacity:.95;animation:ff-flick 1.1s ease-in-out var(--d) infinite alternate}
.ff-c3{fill:#d62828;opacity:.88}
.ff-fire{transition:opacity .8s ease}.ff-fire[data-dim="1"]{opacity:.4}
.ff-heat{transform:translate(${SENSOR.x}px,${SENSOR.y}px) scale(calc(.3 + var(--f,0)*3.6));opacity:calc(var(--f,0)*5)}
.ff-env{opacity:0;transition:opacity .6s ease}.ff-env[data-on="1"]{opacity:.75}
.ff-exit{opacity:.25;transition:opacity .5s ease}.ff-exit[data-on="1"]{opacity:1}
.ff-ring{opacity:0;transform-box:fill-box;transform-origin:center}
.ff-ring[data-on="1"]{animation:ff-ping 1.8s ease-out infinite}
.ff-dot{fill:#0dccf2;stroke:#0dccf2;stroke-opacity:.35;stroke-width:4;transition:opacity .25s ease}
.ff-people[data-go="1"] .ff-dot{fill:#00ffaa;stroke:#00ffaa}
.ff-clear{opacity:0;transform:translate(400px,250px) scale(.8);transition:opacity .5s ease,transform .5s cubic-bezier(.2,1.2,.4,1)}
.ff-clear[data-on="1"]{opacity:1;transform:translate(400px,250px) scale(1)}
.ff-stage[data-live="0"] *{animation-play-state:paused!important}
@keyframes ff-ping{0%{transform:scale(.3);opacity:.9}100%{transform:scale(2.8);opacity:0}}
@keyframes ff-flick{from{opacity:.72}to{opacity:1}}
@keyframes ff-blink{50%{opacity:.25}}
@keyframes ff-glow{from{opacity:.75}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.ff-story *{animation:none!important;transition:none!important}}
`;
