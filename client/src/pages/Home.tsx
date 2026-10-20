import { Button } from "@/components/ui/button";
import { MRUTwin, type SpreadCellLite } from "@/components/visualization/MRUBuilding3D";
import { GeospatialMap } from "@/components/visualization/GeospatialMap";
import { Loader2, ShieldAlert, Shield, FileText, TrendingUp, Wind, Flame, Users, Activity, Radio, Award, Clock, Wifi, WifiOff, Check } from "lucide-react";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useSocket } from "@/contexts/SocketContext";
import { cn } from "@/lib/utils";

const PHASES = ["DETECTING", "SPREADING", "ROUTING", "DISPATCHING", "BROADCASTING", "MONITORING", "COMPLETE"];
const ROUTE_COLORS = ["#0dccf2", "#00ffaa", "#ff9900", "#a855f7"];

const TONE = {
  cyan: { text: "text-fc-cyan", border: "border-fc-cyan/25" },
  red: { text: "text-fc-red", border: "border-fc-red/30" },
  green: { text: "text-fc-green", border: "border-fc-green/25" },
  amber: { text: "text-fc-amber", border: "border-fc-amber/25" },
  slate: { text: "text-slate-300", border: "border-white/10" },
} as const;

const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.max(0, (n / d) * 100)) : 0);
const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// --- UI COMPONENTS ---

function TypewriterText({ text, speed = 20 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState(() => (prefersReducedMotion() ? text : ""));

  useEffect(() => {
    if (prefersReducedMotion() || !text) {
      setDisplayed(text);
      return;
    }
    let i = 0;
    setDisplayed("");
    const timer = setInterval(() => {
      i++;
      setDisplayed(text.substring(0, i));
      if (i >= text.length) clearInterval(timer);
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return <span>{displayed}</span>;
}

function Panel({ title, icon, tone = "slate", className, children }: { title: string; icon?: ReactNode; tone?: keyof typeof TONE; className?: string; children: ReactNode }) {
  return (
    <section className={cn("rounded-lg border bg-fc-panel p-4", TONE[tone].border, className)}>
      <h2 className={cn("mb-3 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest", TONE[tone].text)}>
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Kpi({ label, children, tone = "text-white" }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-fc-panel p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <div className={cn("mt-1 font-mono text-lg font-bold tabular-nums", tone)}>{children}</div>
    </div>
  );
}

export default function Home() {
  const [commandState, setCommandState] = useState<any>(null);
  const [spreadHeatmap, setSpreadHeatmap] = useState<SpreadCellLite[]>([]);
  const lastPhaseRef = useRef<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const flashTimerRef = useRef<number | undefined>(undefined);
  const logEndRef = useRef<HTMLDivElement>(null);
  const { socket, isConnected } = useSocket();
  const utils = trpc.useUtils();

  const phase: string = commandState?.phase || "IDLE";
  const isActive = phase !== "IDLE";
  const isComplete = phase === "COMPLETE";
  const isCritical = isActive && !isComplete;
  const elapsedTimer: number = commandState?.timer_seconds ?? 0;

  const applyState = useCallback((state: any) => {
    setCommandState(state ?? null);
    if (!state) setSpreadHeatmap([]);
    lastPhaseRef.current = state?.phase ?? null;
  }, []);

  // Initial sync (page opened or reloaded mid-incident) + polling fallback while the socket is down.
  const stateQuery = trpc.emergency.getFireCommandState.useQuery(undefined, {
    refetchOnWindowFocus: false,
    refetchInterval: !isConnected && isCritical ? 3000 : false,
  });
  useEffect(() => {
    const data = stateQuery.data;
    if (data === undefined) return;
    if (!isConnected || !commandState) applyState(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateQuery.data]);

  const triggerMutation = trpc.emergency.triggerFireCommand.useMutation({
    onSuccess: async () => {
      toast.success("FireCommand initiated. Multi-agent orchestration active.");
      // Socket normally delivers state; fetch once so the UI moves even if it is down.
      try {
        applyState(await utils.emergency.getFireCommandState.fetch());
      } catch {
        /* socket update will arrive */
      }
    },
    onError: (err) => {
      console.error("[FireCommand Error]", err);
      toast.error(`Trigger failed: ${err.message || "server unreachable"}`);
    },
  });

  const resetMutation = trpc.emergency.resetFireCommand.useMutation({
    onSuccess: () => {
      applyState(null);
      toast.success("System reset. All clear.");
    },
    onError: (err) => toast.error(`Reset failed: ${err.message || "server unreachable"}`),
  });

  const playAlarm = useCallback(() => {
    const ctx = audioRef.current;
    if (!ctx) return; // browsers block audio until the user has interacted
    try {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.warn("Audio failed:", e);
    }
  }, []);

  const sendPushNotification = useCallback((message: string) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification("FIRECOMMAND ALERT", { body: message });
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onUpdate = (state: any) => {
      if (!state) {
        applyState(null); // reset from another client
        return;
      }
      setCommandState(state);

      // Alert on detection (DETECTING -> SPREADING)
      if (state.phase === "SPREADING" && lastPhaseRef.current === "DETECTING") {
        playAlarm();
        sendPushNotification(`Fire detected at ${state.incident_summary?.location?.zone}. AI orchestration initiated.`);
        document.body.classList.add("alert-flash-red");
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = window.setTimeout(() => document.body.classList.remove("alert-flash-red"), 2000);
      }
      if (state.phase) lastPhaseRef.current = state.phase;
    };

    // Granular events patch the latest state so panels move between full-state ticks.
    const patch = (fn: (prev: any) => any) => setCommandState((prev: any) => (prev ? fn(prev) : prev));
    const onSpread = (d: any) => Array.isArray(d?.heatmap) && setSpreadHeatmap(d.heatmap);
    const onEvac = (d: any) =>
      patch(p => ({ ...p, timer_seconds: d.timer ?? p.timer_seconds, evacuation: { ...p.evacuation, evacuated_count: d.evacuated ?? p.evacuation.evacuated_count } }));
    const onVitals = (d: any) => d && patch(p => ({ ...p, health_ops: { ...p.health_ops, triage_summary: d } }));
    const onBroadcast = (d: any) =>
      d && patch(p => ({ ...p, broadcast: { ...p.broadcast, sent_count: d.sent ?? p.broadcast.sent_count, seen_count: d.seen ?? p.broadcast.seen_count, target_count: d.target ?? p.broadcast.target_count } }));
    const onDecision = (d: any) =>
      d?.action && toast.info(`AI decision: ${String(d.action).replace(/_/g, " ")} (${d.priority ?? "n/a"})`, { description: d.reasoning });

    socket.on("firecommand_update", onUpdate);
    socket.on("spread_update", onSpread);
    socket.on("evac_progress", onEvac);
    socket.on("vitals_update", onVitals);
    socket.on("broadcast_status", onBroadcast);
    socket.on("ai_decision", onDecision);
    return () => {
      socket.off("firecommand_update", onUpdate);
      socket.off("spread_update", onSpread);
      socket.off("evac_progress", onEvac);
      socket.off("vitals_update", onVitals);
      socket.off("broadcast_status", onBroadcast);
      socket.off("ai_decision", onDecision);
    };
  }, [socket, playAlarm, sendPushNotification, applyState]);

  // Cleanup audio + body flash on unmount
  useEffect(
    () => () => {
      window.clearTimeout(flashTimerRef.current);
      document.body.classList.remove("alert-flash-red");
      audioRef.current?.close().catch(() => {});
    },
    []
  );

  // Keep newest agent log entry in view
  const logLength = commandState?.agent_log?.length ?? 0;
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [logLength]);

  const handleTrigger = () => {
    // Created inside the click so the browser allows the alarm to play later.
    try {
      audioRef.current ??= new AudioContext();
      void audioRef.current.resume();
    } catch {
      /* audio optional */
    }
    triggerMutation.mutate({
      zone: "Engineering Block Floor 3",
      wind_direction_deg: 0, // wind from the north
      wind_speed_mps: 15,
    });
  };

  const generateReport = async () => {
    if (!commandState) return;
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();
      const state = commandState;

      doc.setFontSize(22);
      doc.text("MRUH FireCommand - After Action Report", 20, 20);
      doc.setFontSize(12);
      doc.text(`Date: ${new Date().toLocaleDateString()} | Duration: ${state.success_metrics.time_minutes} minutes (simulated)`, 20, 30);
      doc.line(20, 35, 190, 35);

      doc.setFont("helvetica", "bold");
      doc.text("INCIDENT SUMMARY", 20, 45);
      doc.setFont("helvetica", "normal");
      doc.text(`Origin: ${state.incident_summary.location.zone}`, 20, 52);
      doc.text(`Confidence: ${(state.incident_summary.confidence * 100).toFixed(0)}%`, 20, 59);
      doc.text(`Wind: ${state.predictions.wind.direction} | Spread: ${state.predictions.spread_direction}`, 20, 66);

      doc.setFont("helvetica", "bold");
      doc.text("EVACUATION METRICS", 20, 80);
      doc.setFont("helvetica", "normal");
      doc.text(`Total Evacuated: ${state.success_metrics.evacuated_count}/${state.evacuation.population_total}`, 20, 87);
      doc.text(`Casualties: ${state.success_metrics.casualties}`, 20, 94);
      doc.text(`Vulnerable Persons Prioritized: ${state.success_metrics.vulnerable_prioritized ? "YES" : "NO"}`, 20, 101);

      doc.setFont("helvetica", "bold");
      doc.text("SDG IMPACT SCORES", 20, 115);
      doc.setFont("helvetica", "normal");
      doc.text(`SDG 11 (Sustainable Cities): ${state.sdg_scores.sdg11}/100`, 20, 122);
      doc.text(`SDG 13 (Climate Action): ${state.sdg_scores.sdg13}/100`, 20, 129);
      doc.text(`SDG 03 (Good Health): ${state.sdg_scores.sdg03}/100`, 20, 136);
      doc.text(`COMBINED SDG SCORE: ${state.sdg_scores.combined}/100`, 20, 143);

      doc.setFont("helvetica", "bold");
      doc.text("AGENT REASONING LOG", 20, 157);
      doc.setFontSize(10);
      let y = 164;
      state.agent_log.forEach((log: any) => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setFont("helvetica", "bold");
        doc.text(`${log.agent} (${log.phase}):`, 20, y);
        doc.setFont("helvetica", "normal");
        const splitText = doc.splitTextToSize(log.reasoning, 160);
        doc.text(splitText, 25, y + 5);
        y += 10 + splitText.length * 5;
      });

      doc.save(`FireCommand_Report_${Date.now()}.pdf`);
      toast.success("After-action report generated");
    } catch (e) {
      console.error("[Report]", e);
      toast.error("Could not generate the report");
    }
  };

  const phaseIdx = PHASES.indexOf(phase);
  const state = commandState;
  const vulnerableTotal: number = state?.evacuation?.vulnerable_total || 33;
  const triage = state?.health_ops?.triage_summary;
  const evacuated: number = state?.evacuation?.evacuated_count ?? 0;
  const population: number = state?.evacuation?.population_total ?? 700;

  return (
    <div className={cn("font-sans text-slate-100 min-h-screen flex flex-col overflow-x-hidden transition-colors duration-1000", isCritical ? "bg-[#0a0000]" : "bg-fc-bg")}>
      {/* Critical Alert Bar */}
      {isCritical && (
        <div role="status" className="relative z-[100] flex w-full items-center justify-center gap-3 border-b border-fc-red/30 bg-fc-red/10 px-4 py-2 animate-pulse">
          <ShieldAlert className="shrink-0 text-fc-red" size={18} aria-hidden="true" />
          <span className="text-center text-xs font-black uppercase tracking-[0.2em] text-fc-red sm:tracking-[0.3em]">
            FireCommand active | Phase: {phase} | {formatTime(elapsedTimer)}
          </span>
        </div>
      )}

      {/* Scoreboard */}
      {isComplete && (
        <div role="status" className="relative z-[100] flex w-full flex-col items-center border-b-4 border-fc-green bg-fc-green/5 px-4 py-6 text-center animate-in fade-in duration-500">
          <Award className="mb-2 text-fc-green" size={40} aria-hidden="true" />
          <p className="text-2xl font-black tracking-tight text-white sm:text-3xl">
            {state.success_metrics.evacuated_count} evacuated in {state.success_metrics.time_minutes} min (simulated)
          </p>
          <p className="mt-1 font-bold uppercase tracking-[0.15em] text-fc-green sm:text-lg sm:tracking-[0.3em]">
            {state.success_metrics.casualties} casualties · {state.evacuation.vulnerable_total} vulnerable prioritized
          </p>
        </div>
      )}

      {/* Header */}
      <header className={cn("sticky top-0 z-50 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 backdrop-blur-xl transition-all sm:px-8", isCritical ? "border-b border-fc-red/20 bg-[#0a0000]/90" : "border-b border-white/5 bg-fc-bg/95")}>
        <Link href="/" className="flex min-w-0 items-center gap-3 sm:gap-4" aria-label="FireCommand home">
          <span className={cn("border p-2", isCritical ? "border-fc-red/50 text-fc-red" : "border-fc-cyan/30 text-fc-cyan")}>
            <Flame size={22} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-xl font-bold tracking-tight text-white">
              FIRE<span className={cn("font-black", isCritical ? "text-fc-red" : "text-fc-cyan")}>COMMAND</span>
            </span>
            <span className="hidden text-[10px] uppercase tracking-widest text-slate-400 sm:block">
              AI evacuation and medical response copilot · SDG 11 + 13 + 3
            </span>
          </span>
        </Link>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span
            role="status"
            className={cn("inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[11px] font-bold", isConnected ? "border-fc-green/40 text-fc-green" : "border-fc-amber/50 text-fc-amber")}
          >
            {isConnected ? <Wifi size={12} aria-hidden="true" /> : <WifiOff size={12} aria-hidden="true" />}
            {isConnected ? "LIVE" : "OFFLINE"}
          </span>
          {isActive && (
            <span className={cn("border px-3 py-1.5 font-mono text-xs font-black tabular-nums", isCritical ? "border-fc-red bg-fc-red/20 text-fc-red" : "border-fc-green bg-fc-green/20 text-fc-green")}>
              <Clock size={12} className="mr-2 inline" aria-hidden="true" />
              {formatTime(elapsedTimer)}
            </span>
          )}
          {isComplete && (
            <Button onClick={generateReport} className="h-9 bg-fc-green text-xs font-black text-black hover:bg-fc-green/80">
              <FileText size={14} aria-hidden="true" /> DOWNLOAD REPORT
            </Button>
          )}
          <Button asChild variant="outline" size="sm"><Link href="/">Home</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href="/how-it-works">How it works</Link></Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[2000px] flex-1 flex-col gap-4 px-4 py-4 sm:gap-6 sm:py-6">
        {/* SDG Alignment Bar */}
        <div className="grid grid-cols-1 gap-px bg-white/5 sm:grid-cols-3">
          {[
            { n: "11", l: "Sustainable Cities", c: "border-fc-red", t: "text-fc-red" },
            { n: "13", l: "Climate Action", c: "border-fc-green", t: "text-fc-green" },
            { n: "3", l: "Good Health", c: "border-fc-cyan", t: "text-fc-cyan" },
          ].map(s => (
            <div key={s.n} className={cn("flex items-center gap-3 border-l-4 bg-black/40 p-3", s.c)}>
              <span className="font-mono text-[11px] font-black uppercase tracking-widest text-slate-400">SDG {s.n}</span>
              <span className={cn("text-xs font-bold", s.t)}>{s.l}</span>
            </div>
          ))}
        </div>

        {/* Mission strip */}
        {isActive && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Phase" tone={isComplete ? "text-fc-green" : "text-fc-red"}>
              <span className="text-base">{phase}</span>
            </Kpi>
            <Kpi label="Elapsed (simulated)">{formatTime(elapsedTimer)}</Kpi>
            <div className="rounded-lg border border-white/10 bg-fc-panel p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Evacuated</p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums text-fc-cyan">{evacuated}<span className="text-slate-500">/{population}</span></p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Evacuation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct(evacuated, population))}>
                <div className="h-full bg-gradient-to-r from-fc-cyan to-fc-green transition-all duration-1000" style={{ width: `${pct(evacuated, population)}%` }} />
              </div>
            </div>
            <Kpi label="Vulnerable safe" tone="text-fc-green">{triage?.green ?? 0}<span className="text-slate-500">/{vulnerableTotal}</span></Kpi>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-5">
          {/* LEFT: trigger + log + phases + wind */}
          <div className="flex flex-col gap-4">
            {!isActive ? (
              <section className="flex flex-col items-center gap-4 rounded-lg border-2 border-fc-red/30 bg-black/40 p-6">
                <Flame size={40} className="text-fc-red" aria-hidden="true" />
                <h2 className="text-lg font-black uppercase tracking-tight text-white">Trigger fire</h2>
                <p className="text-center text-xs leading-relaxed text-slate-400">
                  Starts the multi-agent run: detection, spread prediction, 4 routes, vulnerable prioritization, resource dispatch, broadcast to 700, vitals monitoring.
                </p>
                <dl className="w-full space-y-1 rounded bg-white/5 p-3 text-xs">
                  <div className="flex justify-between"><dt className="text-slate-400">Origin</dt><dd className="font-bold text-white">Engineering Block, F3</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-400">Wind</dt><dd className="font-bold text-fc-green">N @ 15 m/s</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-400">Occupants</dt><dd className="font-bold text-fc-cyan">700 · 33 vulnerable</dd></div>
                </dl>
                <Button onClick={handleTrigger} disabled={triggerMutation.isPending} className="w-full bg-fc-red py-6 text-sm font-black text-white hover:bg-fc-red/80">
                  {triggerMutation.isPending ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <Flame size={16} aria-hidden="true" />}
                  {triggerMutation.isPending ? "STARTING..." : "TRIGGER FIRECOMMAND"}
                </Button>
                <p className="text-center text-[11px] text-slate-500">Simulation only. Nothing real is dispatched.</p>
              </section>
            ) : (
              <>
                <Panel title="Agent thinking log" tone="cyan" icon={<Radio size={12} className="animate-pulse" aria-hidden="true" />} className="flex h-[300px] flex-col border-2 bg-[#010613]">
                  <div role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto font-mono text-xs">
                    {state.agent_log.length === 0 && <p className="italic text-slate-400">Agents are warming up...</p>}
                    {state.agent_log.map((log: any, i: number) => (
                      <div key={`${log.agent}-${log.timestamp ?? i}`} className="border-l-2 border-fc-cyan/30 py-1 pl-3">
                        <p className="mb-1 font-bold uppercase text-fc-cyan">
                          {log.agent} <span className="ml-2 font-normal text-slate-500">[{log.duration_ms ?? 0}ms]</span>
                        </p>
                        <p className="leading-relaxed text-slate-300">
                          <span className="sr-only">{log.reasoning}</span>
                          <span aria-hidden="true">
                            {i === state.agent_log.length - 1 ? <TypewriterText text={log.reasoning} /> : log.reasoning}
                          </span>
                        </p>
                      </div>
                    ))}
                    {!isComplete && (
                      <div className="flex items-center gap-2 italic text-fc-cyan/70">
                        <Loader2 size={10} className="animate-spin" aria-hidden="true" />
                        Waiting for next agent...
                      </div>
                    )}
                    <div ref={logEndRef} />
                  </div>
                </Panel>

                <Panel title="Phase tracker" tone="red">
                  <ol className="space-y-1.5">
                    {PHASES.map((p, i) => {
                      const current = phase === p;
                      const done = i < phaseIdx || isComplete;
                      return (
                        <li
                          key={p}
                          aria-current={current && !isComplete ? "step" : undefined}
                          className={cn("flex items-center gap-2 px-2 py-1 text-xs", current && !isComplete ? "border-l-2 border-fc-red bg-fc-red/10 font-black text-fc-red" : done ? "text-fc-green" : "text-slate-500")}
                        >
                          {done ? <Check size={12} aria-hidden="true" /> : <span className={cn("h-2 w-2 rounded-full", current ? "animate-pulse bg-fc-red" : "bg-white/15")} aria-hidden="true" />}
                          {p}
                          <span className="sr-only">{done ? " (done)" : current ? " (in progress)" : " (pending)"}</span>
                        </li>
                      );
                    })}
                  </ol>
                </Panel>

                {state.predictions && (
                  <Panel title="SDG 13 climate" tone="green" icon={<Wind size={12} aria-hidden="true" />}>
                    <div className="space-y-3 text-xs">
                      <div className="flex justify-between"><span className="text-slate-400">Wind from</span><span className="font-bold text-fc-green">{state.predictions.wind.direction} @ {state.predictions.wind.speed_mps} m/s</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Spread direction</span><span className="font-bold text-fc-red">{state.predictions.spread_direction}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Evac window</span><span className="animate-pulse font-bold text-fc-amber">{state.predictions.evac_window_minutes} MIN</span></div>
                      <div className="flex justify-center py-2" aria-hidden="true">
                        <div className="relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-fc-green/30">
                          <div style={{ transform: `rotate(${state.predictions.wind.direction_deg}deg)` }} className="transition-transform">
                            <div className="relative h-8 w-0.5 bg-fc-green">
                              <div className="absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-b-[8px] border-l-[5px] border-r-[5px] border-b-fc-green border-l-transparent border-r-transparent" />
                            </div>
                          </div>
                          <span className="absolute top-0 text-[9px] text-fc-green">N</span>
                          <span className="absolute bottom-0 text-[9px] text-slate-400">S</span>
                        </div>
                      </div>
                    </div>
                  </Panel>
                )}

                <Button onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending} variant="outline" className="w-full border-white/20 text-xs text-slate-300 hover:text-white">
                  {resetMutation.isPending ? <Loader2 className="animate-spin" size={12} aria-hidden="true" /> : <Shield size={12} aria-hidden="true" />}
                  RESET SYSTEM
                </Button>
              </>
            )}
          </div>

          {/* CENTER: 3D + map (after the command panels on small screens) */}
          <div className="order-last space-y-4 xl:order-none xl:col-span-2">
            <div className={cn("glass-panel relative h-[360px] w-full border-[3px] p-1 transition-all sm:h-[500px] lg:h-[700px]", isCritical ? "border-fc-red/60 shadow-[0_0_40px_rgba(255,0,60,0.3)]" : "border-fc-cyan/30")}>
              <div className="absolute inset-0 z-0 h-full w-full" role="region" aria-label="MRUH campus 3D digital twin">
                <MRUTwin
                  isCritical={isCritical}
                  scenario={isCritical ? "TEST_CASE_3" : null}
                  spreadHeatmap={spreadHeatmap}
                  wind={state?.predictions?.wind}
                />
              </div>

              {/* HUD Overlay */}
              <div className="absolute left-2 top-2 z-10 border border-white/10 bg-black/80 p-3 font-mono text-[11px] sm:left-4 sm:top-4">
                <p className="text-fc-cyan">&gt; MRUH CAMPUS DIGITAL TWIN</p>
                <p className={isCritical ? "text-fc-red" : "text-slate-400"}>&gt; STATUS: {phase}</p>
                {state?.predictions && <p className="text-fc-green">&gt; WIND: {state.predictions.wind.direction} {state.predictions.wind.speed_mps}m/s</p>}
              </div>
            </div>

            <GeospatialMap isCritical={isCritical} />
          </div>

          {/* RIGHT: command panels */}
          <div className="flex flex-col gap-4 xl:col-span-2">
            {!state && (
              <section className="rounded-lg border border-dashed border-white/15 bg-fc-panel p-6 text-center">
                <Activity className="mx-auto mb-3 text-slate-500" size={28} aria-hidden="true" />
                <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-slate-300">Standing by</h2>
                <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-400">
                  {stateQuery.isLoading
                    ? "Checking for an active incident..."
                    : "No active incident. Trigger the scenario to see incident summary, evacuation routes, triage, dispatch, broadcast and SDG scores fill in live."}
                </p>
              </section>
            )}

            {state && (
              <Panel title="Incident summary" tone={isCritical ? "red" : "green"} icon={<Flame size={12} aria-hidden="true" />} className="border-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-white/5 p-2"><p className="text-slate-400">Zone</p><p className="font-bold text-white">{state.incident_summary.location.zone}</p></div>
                  <div className="rounded bg-white/5 p-2"><p className="text-slate-400">Confidence</p><p className="font-bold text-fc-green">{(state.incident_summary.confidence * 100).toFixed(0)}%</p></div>
                  <div className="rounded bg-white/5 p-2"><p className="text-slate-400">Population</p><p className="font-bold text-fc-cyan">{state.evacuation.population_total}</p></div>
                  <div className="rounded bg-white/5 p-2"><p className="text-slate-400">Vulnerable</p><p className="font-bold text-fc-amber">{state.evacuation.vulnerable_total}</p></div>
                </div>
              </Panel>
            )}

            {state?.evacuation?.routes?.length > 0 && (
              <Panel title="4 evacuation routes" tone="cyan" icon={<TrendingUp size={12} aria-hidden="true" />}>
                <ul className="space-y-2">
                  {state.evacuation.routes.map((route: any, i: number) => (
                    <li key={route.type} className="rounded bg-white/5 p-3" style={{ borderLeft: `3px solid ${ROUTE_COLORS[i % 4]}` }}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase text-white">{route.type}</span>
                        <span className="text-xs font-bold" style={{ color: ROUTE_COLORS[i % 4] }}>{route.eta_min} min</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{route.description}</p>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {state && triage && (
              <Panel title="Vulnerable priority board" tone="amber" icon={<Users size={12} aria-hidden="true" />}>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded border border-fc-red/20 bg-fc-red/10 p-3"><p className="text-lg font-black text-fc-red">{triage.red}</p><p className="text-[10px] uppercase text-slate-400">At risk</p></div>
                  <div className="rounded border border-fc-amber/20 bg-fc-amber/10 p-3"><p className="text-lg font-black text-fc-amber">{triage.yellow}</p><p className="text-[10px] uppercase text-slate-400">Evacuating</p></div>
                  <div className="rounded border border-fc-green/20 bg-fc-green/10 p-3"><p className="text-lg font-black text-fc-green">{triage.green}</p><p className="text-[10px] uppercase text-slate-400">Safe</p></div>
                </div>
                <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                  <div className="bg-fc-green transition-all" style={{ width: `${pct(triage.green, vulnerableTotal)}%` }} />
                  <div className="bg-fc-amber transition-all" style={{ width: `${pct(triage.yellow, vulnerableTotal)}%` }} />
                  <div className="bg-fc-red transition-all" style={{ width: `${pct(triage.red, vulnerableTotal)}%` }} />
                </div>
              </Panel>
            )}

            {state?.resources?.ambulances_dispatched?.length > 0 && (
              <Panel title="Resource dispatch" tone="red" icon={<Activity size={12} aria-hidden="true" />}>
                <ul className="space-y-2">
                  {state.resources.ambulances_dispatched.map((amb: any) => (
                    <li key={`a-${amb.id}`} className="flex items-center justify-between gap-2 rounded border-l-2 border-fc-red bg-white/5 p-2">
                      <span className="text-xs font-bold text-white">{amb.name}</span>
                      <span className="text-[11px] text-fc-amber">ETA {amb.eta_minutes}m to {amb.target_zone}</span>
                    </li>
                  ))}
                  {state.resources.fire_response.map((fr: any) => (
                    <li key={`f-${fr.id}`} className="flex items-center justify-between gap-2 rounded border-l-2 border-fc-amber bg-white/5 p-2">
                      <span className="text-xs font-bold text-white">{fr.name}</span>
                      <span className="text-[11px] text-fc-green">{String(fr.status).toUpperCase()}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {state?.broadcast && (
              <Panel title="Broadcast console" tone="cyan" icon={<Radio size={12} aria-hidden="true" />}>
                <div className="mb-3 grid grid-cols-3 gap-2">
                  {[["Target", state.broadcast.target_count, "text-fc-cyan"], ["Sent", state.broadcast.sent_count, "text-fc-green"], ["Seen", state.broadcast.seen_count, "text-fc-amber"]].map(([l, v, c]) => (
                    <div key={l as string} className="rounded bg-white/5 p-2 text-center">
                      <p className="text-[10px] uppercase text-slate-400">{l}</p>
                      <p className={cn("text-lg font-black tabular-nums", c as string)}>{v}</p>
                    </div>
                  ))}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                  <div className="h-full bg-gradient-to-r from-fc-cyan to-fc-green transition-all duration-1000" style={{ width: `${pct(state.broadcast.sent_count, state.broadcast.target_count)}%` }} />
                </div>
                {state.broadcast.message && (
                  <p className="mt-2 border-l-2 border-white/15 pl-2 text-[11px] italic leading-relaxed text-slate-400">"{state.broadcast.message}"</p>
                )}
              </Panel>
            )}

            {state?.sdg_scores && (
              <Panel title="SDG impact scorecard" tone="green" icon={<Award size={12} aria-hidden="true" />} className="border-2">
                <div className="space-y-3">
                  {[
                    { id: "11", label: "Sustainable Cities", score: state.sdg_scores.sdg11, color: "#ff003c" },
                    { id: "13", label: "Climate Action", score: state.sdg_scores.sdg13, color: "#00ffaa" },
                    { id: "03", label: "Good Health", score: state.sdg_scores.sdg03, color: "#0dccf2" },
                  ].map(sdg => (
                    <div key={sdg.id}>
                      <div className="mb-1 flex justify-between text-[11px]">
                        <span className="text-slate-300">SDG {sdg.id} {sdg.label}</span>
                        <span style={{ color: sdg.color }} className="font-bold">{sdg.score}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={`SDG ${sdg.id} score`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={sdg.score}>
                        <div className="h-full transition-all duration-1000" style={{ width: `${pct(sdg.score, 100)}%`, backgroundColor: sdg.color }} />
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-white/10 pt-2">
                    <span className="text-xs font-black uppercase text-white">Combined impact</span>
                    <span className="text-xl font-black text-fc-green">{state.sdg_scores.combined}/100</span>
                  </div>
                </div>
              </Panel>
            )}

            {state?.counterfactuals && (
              <Panel title="Without FireCommand (modeled)" tone="slate" icon={<TrendingUp size={12} aria-hidden="true" />} className="border-2 bg-black">
                <div className="space-y-2 text-xs text-slate-300">
                  <div className="flex justify-between"><span>Detection delay</span><span className="font-mono text-red-400">+{state.counterfactuals.traditional_detection_delay_min}m</span></div>
                  <div className="flex justify-between"><span>Evacuation time</span><span className="font-mono text-red-400">{state.counterfactuals.traditional_time_min}m</span></div>
                  <div className="flex justify-between"><span>Est. casualties</span><span className="font-mono font-bold text-red-400">{state.counterfactuals.traditional_casualties}</span></div>
                </div>
                <p className="mt-3 border border-fc-red/30 bg-fc-red/10 p-2 text-center text-xs font-black uppercase text-fc-red">
                  Modeled casualties avoided: {state.counterfactuals.traditional_casualties}
                </p>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">Baseline is an assumption for comparison, not field data.</p>
              </Panel>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
