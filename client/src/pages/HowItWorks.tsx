import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, ExternalLink, Flame } from "lucide-react";
import { Link } from "wouter";

const HEALTH_PORTAL = "https://healthai-production-d6ad.up.railway.app";

const AGENTS = [
  { name: "SensorFusion", does: "Fuses smoke, temperature and CCTV into a fire confidence score.", stage: "Monitor" },
  { name: "SpreadPredictor", does: "Turns wind and terrain into a spread direction and evacuation window.", stage: "Predict" },
  { name: "EvacuationPlanner", does: "Ranks fastest, safest, accessible and low-crowd routes.", stage: "Decide" },
  { name: "VulnerabilityTriage", does: "Places the 33 vulnerable people into three evacuation waves.", stage: "Decide" },
  { name: "ResourceAllocator", does: "Sends ambulances, medical teams and fire units to assembly points.", stage: "Decide" },
  { name: "BroadcastAgent", does: "Writes and pushes the alert to all 700 occupants.", stage: "Evacuate" },
  { name: "HealthMonitor", does: "Tracks evacuation progress and triage status until everyone is safe.", stage: "Evacuate" },
];

const SDGS = [
  {
    n: "11",
    name: "Sustainable Cities",
    tone: "border-fc-red/30 text-fc-red",
    items: ["Fire detected from fused sensor signals", "Four evacuation routes computed", "Ambulances and resources allocated", "Alerts broadcast to 700 occupants"],
  },
  {
    n: "13",
    name: "Climate Action",
    tone: "border-fc-green/30 text-fc-green",
    items: ["Wind direction and speed analysed", "Spread direction predicted", "Evacuation window estimated (about 15 min)", "Terrain and slope considered"],
  },
  {
    n: "03",
    name: "Good Health",
    tone: "border-fc-cyan/30 text-fc-cyan",
    items: ["33 vulnerable people tracked", "Accessible, low-slope routes planned", "Ambulances and medical teams staged", "Triage and vitals monitored"],
  },
];

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-fc-bg text-slate-100 overflow-x-clip">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-fc-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="FireCommand home">
            <Flame className="h-5 w-5 text-fc-red" aria-hidden="true" />
            <span className="font-display text-lg font-bold text-white">
              Fire<span className="text-fc-cyan">Command</span>
            </span>
          </Link>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm"><Link href="/">Home</Link></Button>
            <Button asChild size="sm"><Link href="/command-center">Console</Link></Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-12 px-4 py-10 sm:px-6 sm:py-14">
        <div className="max-w-2xl">
          <p className="fc-eyebrow mb-3 text-fc-cyan">Architecture</p>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">How FireCommand works</h1>
          <p className="mt-4 leading-relaxed text-slate-300">
            Seven specialised agents run in sequence, each handing its result to the next. Every call and its
            reasoning is logged on the console, so the human commander can see why a decision was made.
          </p>
        </div>

        <section aria-labelledby="agents">
          <h2 id="agents" className="mb-4 text-xl font-bold text-white">Multi-agent flow</h2>
          <ol className="grid gap-3 sm:grid-cols-2">
            {AGENTS.map((a, i) => (
              <li key={a.name} className="flex gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <span className="font-mono text-sm font-bold text-slate-500">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-fc-cyan">{a.name}</span>
                    <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">{a.stage}</span>
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-300">{a.does}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="sdgs">
          <h2 id="sdgs" className="mb-4 text-xl font-bold text-white">Sustainable Development Goals</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {SDGS.map(s => (
              <div key={s.n} className={cn("rounded-xl border bg-white/[0.03] p-5", s.tone)}>
                <h3 className="font-bold">SDG {s.n}</h3>
                <p className="text-sm font-semibold text-white">{s.name}</p>
                <ul className="mt-3 list-disc space-y-1.5 pl-4 text-sm text-slate-300 marker:text-slate-500">
                  {s.items.map(it => <li key={it}>{it}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-fc-cyan/30 bg-fc-cyan/[0.06] p-6">
          <h2 className="text-xl font-bold text-fc-cyan">Built-in demo scenario</h2>
          <p className="mt-2 leading-relaxed text-slate-200">
            In the simulated run, 700 people are evacuated in about 7 minutes with zero casualties, every vulnerable
            person is prioritised, and medical support is staged. These are simulation outputs, not field measurements.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/command-center">
                Run the simulation
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={HEALTH_PORTAL} target="_blank" rel="noopener noreferrer">
                Open Health Portal
                <ExternalLink aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
