import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Activity,
  ArrowRight,
  Check,
  ExternalLink,
  FileText,
  Flame,
  HeartPulse,
  Layers,
  Megaphone,
  Radar,
  Route as RouteIcon,
  ShieldCheck,
  Siren,
  Users,
  Wind,
} from "lucide-react";
import { ReactNode, Suspense, lazy, useEffect, useRef, useState } from "react";
const ScrollStory = lazy(() => import("@/components/landing/ScrollStory"));
import { Link } from "wouter";

const HEALTH_PORTAL = "https://healthai-production-d6ad.up.railway.app";

/* ---------- small helpers ---------- */

/** Fades a block in once when it scrolls into view (opacity/transform only). */
function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      el.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={cn("reveal", className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

function SectionHead({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="fc-eyebrow text-fc-cyan mb-3">{eyebrow}</p>
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
        {title}
      </h2>
      {lead && <p className="mt-4 text-slate-300 leading-relaxed">{lead}</p>}
    </div>
  );
}

function SdgChip({ n, label, tone }: { n: string; label: string; tone: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        tone
      )}
    >
      <span className="font-mono font-bold">SDG {n}</span>
      <span className="text-slate-300">{label}</span>
    </span>
  );
}

/* ---------- live product preview (client-side simulation) ---------- */

const PHASES = [
  "DETECTING",
  "SPREADING",
  "ROUTING",
  "DISPATCHING",
  "BROADCASTING",
  "MONITORING",
  "COMPLETE",
] as const;

type Step = { phase: number; secs: number; evac: number; agent?: string; line?: string };

const SCRIPT: Step[] = [
  { phase: 0, secs: 30, evac: 0, agent: "SensorFusion", line: "Smoke 82/100, 61 C, CCTV motion. Fire confirmed, 97% confidence." },
  { phase: 1, secs: 60, evac: 0, agent: "SpreadPredictor", line: "15 m/s north wind. Spread heading south. About 15 min to evacuate." },
  { phase: 2, secs: 120, evac: 0, agent: "EvacuationPlanner", line: "4 routes ranked. 33 vulnerable people placed in waves 1 to 3." },
  { phase: 3, secs: 180, evac: 0, agent: "ResourceAllocator", line: "Ambulances and fire units sent to assembly points." },
  { phase: 4, secs: 240, evac: 0, agent: "BroadcastAgent", line: "Route and time window pushed to 700 occupants." },
  { phase: 5, secs: 300, evac: 210, agent: "HealthMonitor", line: "Evacuation under way. Vitals and triage tracked live." },
  { phase: 5, secs: 360, evac: 420 },
  { phase: 5, secs: 390, evac: 600 },
  { phase: 6, secs: 420, evac: 700, agent: "Commander", line: "All 700 accounted for. After-action report ready." },
];
const HOLD_TICKS = 3;

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function LivePreview() {
  const reduce = usePrefersReducedMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setTick(t => t + 1);
    }, 1700);
    return () => window.clearInterval(id);
  }, [reduce]);

  const last = SCRIPT.length - 1;
  const idx = reduce ? last : Math.min(tick % (SCRIPT.length + HOLD_TICKS), last);
  const step = SCRIPT[idx];
  const done = step.phase === 6;
  const log = SCRIPT.slice(0, idx + 1).filter(s => s.line);

  return (
    <div
      role="img"
      aria-label="Simulated preview of the FireCommand console: seven agents move from detection to a completed evacuation of 700 people."
      className="relative rounded-xl border border-fc-cyan/30 bg-fc-panel shadow-[0_0_60px_rgba(13,204,242,0.12)] overflow-hidden"
    >
      <div aria-hidden="true">
        {/* window bar */}
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <Flame className={cn("h-4 w-4 shrink-0", done ? "text-fc-green" : "text-fc-red")} />
            <span className="font-mono text-xs text-slate-300 truncate">firecommand / live console</span>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-fc-amber/40 bg-fc-amber/10 px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest text-fc-amber">
            <span className="h-1.5 w-1.5 rounded-full bg-fc-amber animate-pulse" />
            SIMULATED
          </span>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-400">Phase</p>
              <p className={cn("mt-1 font-mono text-xs sm:text-sm font-bold truncate", done ? "text-fc-green" : "text-fc-red")}>
                {PHASES[step.phase]}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-400">Elapsed</p>
              <p className="mt-1 font-mono text-sm font-bold text-white tabular-nums">{clock(step.secs)}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-400">Evacuated</p>
              <p className="mt-1 font-mono text-sm font-bold text-fc-cyan tabular-nums">{step.evac}/700</p>
            </div>
          </div>

          {/* progress (transform only) */}
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full w-full origin-left rounded-full bg-gradient-to-r from-fc-cyan to-fc-green transition-transform duration-1000 ease-out"
              style={{ transform: `scaleX(${step.evac / 700})` }}
            />
          </div>

          {/* phase stepper */}
          <ol className="grid grid-cols-7 gap-1">
            {PHASES.map((p, i) => (
              <li key={p} className="flex flex-col gap-1">
                <span
                  className={cn(
                    "h-1 rounded-full transition-colors duration-500",
                    i < step.phase || done ? "bg-fc-green" : i === step.phase ? "bg-fc-red" : "bg-white/10"
                  )}
                />
                <span className="hidden sm:block truncate font-mono text-[9px] text-slate-500">
                  {p.slice(0, 4)}
                </span>
              </li>
            ))}
          </ol>

          {/* agent log: fixed height so nothing shifts */}
          <div className="relative h-[196px] overflow-hidden rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-[11px] sm:text-xs leading-relaxed">
            <div className="absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-fc-panel to-transparent" />
            <div className="flex h-full flex-col justify-end gap-2.5">
              {log.map((s, i) => (
                <p key={s.agent} className={i === log.length - 1 ? "text-slate-100" : "text-slate-400"}>
                  <span className="font-bold text-fc-cyan">{s.agent}</span>
                  <span className="text-slate-500"> &gt; </span>
                  <span className={i === log.length - 1 && !done ? "fc-caret" : undefined}>{s.line}</span>
                </p>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Wind className="h-3.5 w-3.5 text-fc-green" /> Wind N 15 m/s, spread S
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-fc-amber" />
              {step.phase >= 2 ? "33/33 vulnerable prioritised" : "Triage pending"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- content ---------- */

const PIPELINE = [
  {
    n: "01",
    title: "Monitor",
    agents: "SensorFusion",
    icon: Radar,
    tone: "text-fc-red border-fc-red/30 bg-fc-red/10",
    body: "Smoke, temperature and CCTV signals fuse into one confidence score. It leans toward detection, because a missed fire costs more than a false alarm.",
  },
  {
    n: "02",
    title: "Predict spread",
    agents: "SpreadPredictor",
    icon: Wind,
    tone: "text-fc-green border-fc-green/30 bg-fc-green/10",
    body: "Wind direction, speed and terrain give a spread direction, the zones at risk and a live evacuation window in minutes.",
  },
  {
    n: "03",
    title: "Decide",
    agents: "EvacuationPlanner, VulnerabilityTriage, ResourceAllocator",
    icon: RouteIcon,
    tone: "text-fc-cyan border-fc-cyan/30 bg-fc-cyan/10",
    body: "Four route strategies (fastest, safest, accessible, low-crowd) are ranked, vulnerable people are placed in waves, and units are assigned to assembly points.",
  },
  {
    n: "04",
    title: "Evacuate",
    agents: "BroadcastAgent, HealthMonitor",
    icon: Megaphone,
    tone: "text-fc-amber border-fc-amber/30 bg-fc-amber/10",
    body: "Occupants get a clear alert with their route and time window, while triage and vitals are tracked until everyone is accounted for.",
  },
];

const FEATURES = [
  { icon: Layers, title: "Seven cooperating agents", body: "Each phase is a separate agent. Every decision is logged with its reasoning, so a human commander can audit it." },
  { icon: Wind, title: "Wind-aware spread model", body: "Predicts which way the fire travels and how long people have, instead of treating every exit as equal." },
  { icon: RouteIcon, title: "Four route strategies", body: "Fastest, safest, accessible and low-crowd routes are computed together and ranked for the live situation." },
  { icon: HeartPulse, title: "Vulnerable-first triage", body: "33 vulnerable people are tracked and sequenced into evacuation waves, with ambulances staged ahead of them." },
  { icon: Activity, title: "3D twin and live map", body: "A digital twin of the MRUH campus and a geospatial map update over WebSockets as agents report." },
  { icon: FileText, title: "After-action report", body: "One click exports a PDF with the timeline, SDG scores and the full agent reasoning log." },
];

const SDGS = [
  { n: "11", name: "Sustainable Cities", icon: ShieldCheck, tone: "border-fc-red/30 text-fc-red", body: "Faster detection, four evacuation routes, resource dispatch and a broadcast to every occupant." },
  { n: "13", name: "Climate Action", icon: Wind, tone: "border-fc-green/30 text-fc-green", body: "Wind-driven fire behaviour is a growing climate risk. Spread prediction buys a defined evacuation window." },
  { n: "03", name: "Good Health", icon: HeartPulse, tone: "border-fc-cyan/30 text-fc-cyan", body: "Accessible routing, ambulance staging and live triage protect the people least able to self-evacuate." },
];

const STATS = [
  { v: "700", l: "occupants evacuated", s: "in the simulated MRUH scenario" },
  { v: "~7 min", l: "simulated evacuation", s: "vs 18 min modeled manual baseline" },
  { v: "33/33", l: "vulnerable people prioritised", s: "placed in waves ahead of the crowd" },
  { v: "7", l: "agents, every call logged", s: "reasoning visible to the commander" },
];

/* ---------- page ---------- */

export default function Landing() {
  return (
    <div className="min-h-screen bg-fc-bg text-slate-100 overflow-x-clip">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[10000] focus:rounded focus:bg-fc-cyan focus:px-3 focus:py-2 focus:text-fc-bg"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-50 border-b border-white/10 bg-fc-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 py-3">
          <Link href="/" className="flex items-center gap-2.5 min-w-0" aria-label="FireCommand home">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-fc-red/40 bg-fc-red/10">
              <Flame className="h-4 w-4 text-fc-red" aria-hidden="true" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-white">
              Fire<span className="text-fc-cyan">Command</span>
            </span>
          </Link>
          <nav aria-label="Primary" className="hidden md:flex items-center gap-6 text-sm text-slate-300">
            <a href="#pipeline" className="hover:text-white">Pipeline</a>
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#sdg" className="hover:text-white">SDGs</a>
            <a href="#impact" className="hover:text-white">Impact</a>
            <Link href="/how-it-works" className="hover:text-white">How it works</Link>
          </nav>
          <Button asChild size="sm">
            <Link href="/command-center">Open console</Link>
          </Button>
        </div>
      </header>

      <main id="main">
        {/* HERO */}
        <section className="fc-hero-bg">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 py-14 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
            <div>
              <p className="fc-eyebrow text-fc-red mb-4 inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-fc-red animate-pulse" aria-hidden="true" />
                AI incident commander for campus fire emergencies
              </p>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight text-white">
                The fire spreads in minutes.{" "}
                <span className="text-fc-cyan">FireCommand decides in seconds.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base sm:text-lg leading-relaxed text-slate-300">
                Seven cooperating AI agents detect the fire, predict wind-driven spread, rank four evacuation
                routes, put vulnerable people first and dispatch responders, all in one live command console.
              </p>
              <div className="mt-7 flex flex-col sm:flex-row gap-3">
                <Button asChild size="lg" className="h-11 px-6 text-base">
                  <Link href="/command-center">
                    Launch live simulation
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-11 px-6 text-base">
                  <Link href="/how-it-works">See how it works</Link>
                </Button>
              </div>
              <div className="mt-7 flex flex-wrap gap-2">
                <SdgChip n="11" label="Sustainable Cities" tone="border-fc-red/30 bg-fc-red/5 text-fc-red" />
                <SdgChip n="13" label="Climate Action" tone="border-fc-green/30 bg-fc-green/5 text-fc-green" />
                <SdgChip n="3" label="Good Health" tone="border-fc-cyan/30 bg-fc-cyan/5 text-fc-cyan" />
              </div>
              <p className="mt-5 max-w-xl text-xs leading-relaxed text-slate-400">
                Runs on a simulated MRUH campus digital twin. A hackathon prototype, not a certified life-safety system.
              </p>
            </div>

            <LivePreview />
          </div>
        </section>

        <Suspense fallback={null}><ScrollStory /></Suspense>

        {/* PIPELINE */}
        <section id="pipeline" className="border-t border-white/10">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-24">
            <Reveal>
              <SectionHead
                eyebrow="How it works"
                title="Monitor, predict, decide, evacuate"
                lead="One loop, run by specialised agents that hand context to each other. The commander watches, and can read every step."
              />
            </Reveal>
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PIPELINE.map((p, i) => (
                <li key={p.n}>
                  <Reveal delay={i * 70} className="h-full">
                    <div className="h-full rounded-xl border border-white/10 bg-white/[0.03] p-5">
                      <div className="flex items-center justify-between">
                        <span className={cn("grid h-10 w-10 place-items-center rounded-lg border", p.tone)}>
                          <p.icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <span className="font-mono text-xs text-slate-500">{p.n}</span>
                      </div>
                      <h3 className="mt-4 text-lg font-bold text-white">{p.title}</h3>
                      <p className="mt-1 font-mono text-[11px] text-fc-cyan">{p.agents}</p>
                      <p className="mt-3 text-sm leading-relaxed text-slate-300">{p.body}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="border-t border-white/10 bg-white/[0.02]">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-24">
            <Reveal>
              <SectionHead
                eyebrow="Features"
                title="Built for the first ten minutes"
                lead="Everything a campus safety officer needs on one screen when the alarm goes off."
              />
            </Reveal>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <Reveal key={f.title} delay={(i % 3) * 70}>
                  <div className="h-full rounded-xl border border-white/10 bg-fc-panel p-5 transition-colors hover:border-fc-cyan/40">
                    <f.icon className="h-5 w-5 text-fc-cyan" aria-hidden="true" />
                    <h3 className="mt-3 font-bold text-white">{f.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">{f.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* SDG */}
        <section id="sdg" className="border-t border-white/10">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-24">
            <Reveal>
              <SectionHead
                eyebrow="Impact goals"
                title="Aligned with three UN Sustainable Development Goals"
              />
            </Reveal>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {SDGS.map((s, i) => (
                <Reveal key={s.n} delay={i * 70}>
                  <div className={cn("h-full rounded-xl border bg-white/[0.03] p-5", s.tone)}>
                    <div className="flex items-center gap-2">
                      <s.icon className="h-5 w-5" aria-hidden="true" />
                      <h3 className="font-bold">SDG {s.n}</h3>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-white">{s.name}</p>
                    <p className="mt-3 text-sm leading-relaxed text-slate-300">{s.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* IMPACT */}
        <section id="impact" className="border-t border-white/10 bg-white/[0.02]">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-24">
            <Reveal>
              <SectionHead
                eyebrow="Simulation results"
                title="What the built-in scenario shows"
                lead="Engineering Block fire, 15 m/s north wind, 700 occupants, 33 vulnerable people."
              />
            </Reveal>
            <dl className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {STATS.map((s, i) => (
                <Reveal key={s.l} delay={i * 70}>
                  <div className="h-full rounded-xl border border-fc-cyan/25 bg-fc-cyan/[0.06] p-4 sm:p-5">
                    <dd className="font-display text-3xl sm:text-4xl font-bold text-fc-cyan tabular-nums">{s.v}</dd>
                    <dt className="mt-1 text-sm font-semibold text-white">{s.l}</dt>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">{s.s}</p>
                  </div>
                </Reveal>
              ))}
            </dl>
            <p className="mt-6 max-w-3xl text-xs leading-relaxed text-slate-400">
              These are simulation outputs, not field measurements. The manual baseline (18 minutes, 24 estimated
              casualties) is a modeled assumption used for comparison. Real deployment would need validation with
              campus safety teams and drills.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-white/10">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
            <Reveal>
              <div className="rounded-2xl border border-fc-red/30 bg-gradient-to-br from-fc-red/10 via-fc-panel to-fc-cyan/10 p-6 sm:p-10 text-center">
                <Siren className="mx-auto h-8 w-8 text-fc-red" aria-hidden="true" />
                <h2 className="mt-4 text-2xl sm:text-3xl font-bold text-white">
                  Start a fire. Watch the agents handle it.
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-slate-300">
                  One button in the console triggers the full scenario. Nothing real is affected.
                </p>
                <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Button asChild size="lg" className="h-11 px-6 text-base">
                    <Link href="/command-center">
                      Launch live simulation
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="h-11 px-6 text-base">
                    <Link href="/how-it-works">Read the architecture</Link>
                  </Button>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-fc-panel">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 py-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Flame className="h-5 w-5 text-fc-red" aria-hidden="true" />
              <span className="font-display text-lg font-bold text-white">
                Fire<span className="text-fc-cyan">Command</span>
              </span>
            </div>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
              AI incident commander for campus fire emergencies. Built for MRUH on SDG 11, 13 and 3.
            </p>
          </div>
          <nav aria-label="Product" className="text-sm">
            <p className="fc-eyebrow text-slate-500 mb-3">Product</p>
            <ul className="space-y-2 text-slate-300">
              <li><Link href="/command-center" className="hover:text-fc-cyan">Command console</Link></li>
              <li><Link href="/how-it-works" className="hover:text-fc-cyan">How it works</Link></li>
              <li>
                <a href={HEALTH_PORTAL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-fc-cyan">
                  MRUH Health Portal
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            </ul>
          </nav>
          <nav aria-label="On this page" className="text-sm">
            <p className="fc-eyebrow text-slate-500 mb-3">On this page</p>
            <ul className="space-y-2 text-slate-300">
              <li><a href="#pipeline" className="hover:text-fc-cyan">Pipeline</a></li>
              <li><a href="#features" className="hover:text-fc-cyan">Features</a></li>
              <li><a href="#impact" className="hover:text-fc-cyan">Simulation results</a></li>
            </ul>
          </nav>
        </div>
        <div className="border-t border-white/5">
          <p className="mx-auto flex max-w-6xl items-start gap-2 px-4 sm:px-6 py-4 text-xs text-slate-500">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Hackathon prototype running on simulated data. Not a substitute for certified fire-safety systems or emergency services.
          </p>
        </div>
      </footer>
    </div>
  );
}
