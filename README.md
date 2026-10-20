# FireCommand: AI Incident Commander for MRUH

Multi-agent AI system that detects a campus fire, predicts its spread, plans evacuation routes, dispatches responders, broadcasts alerts and tracks evacuee health, all on a live 3D digital twin of the MRUH campus. Built for Hackathon 2026, aligned with UN SDG 11, 13 and 3.

> **Status: hackathon prototype.** Everything runs on a *simulated* campus (simulated sensors, occupancy and fire). It is not a certified life-safety system. See [Known limitations](#13-known-limitations-and-handoff-notes) before building on it.

---

## Contents

1. [Quick start](#1-quick-start)
2. [Scripts](#2-scripts)
3. [Environment variables](#3-environment-variables)
4. [Architecture](#4-architecture)
5. [Repository layout](#5-repository-layout)
6. [Backend](#6-backend)
7. [Realtime contract (Socket.io)](#7-realtime-contract-socketio)
8. [API reference (tRPC)](#8-api-reference-trpc)
9. [Frontend](#9-frontend)
10. [Design system and CSS](#10-design-system-and-css)
11. [Deployment](#11-deployment)
12. [Testing and verification](#12-testing-and-verification)
13. [Known limitations and handoff notes](#13-known-limitations-and-handoff-notes)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Quick start

Requirements: Node.js 20.19+ or 22.12+ (Vite 7 requirement; developed on 24) and npm. Windows, macOS and Linux work (`cross-env` handles env vars).

```bash
npm install            # .npmrc sets legacy-peer-deps=true, this is intentional
cp .env.example .env   # every key is optional, see section 3
npm run dev            # http://localhost:3000  (Vite + API + Socket.io on one port)
```

Open:

| URL | What |
|---|---|
| `/` | Landing page (hero, simulated console preview, scroll-driven story, pipeline, SDGs) |
| `/how-it-works` | Explains the 7 agents and SDG mapping |
| `/command-center` | The live dashboard: 3D twin, agent log, evacuation, triage, report export |
| `/health` | JSON health check, `{ "status": "ok" }` |

**To see the system work:** open `/command-center`, press the trigger button. The monitor loop then walks the fire through its phases (section 6.2).

**No API keys? It still runs.** Without `GOOGLE_AI_KEY` every agent falls back to deterministic rule-based output, so the demo never hard-fails. With the key, decisions come from Gemini.

---

## 2. Scripts

| Command | Does |
|---|---|
| `npm run dev` | `tsx watch` the server in `development` mode; Vite runs as Express middleware (HMR) |
| `npm run host` | Runs the server from source with `BYPASS_AUTH=true` and serves the **built** client from `dist/public` (run `npm run build` first). Handy for a tunnel or demo box |
| `npm run build` | `build:client` (Vite to `dist/public`) then `build:server` (esbuild to `dist/index.js`) |
| `npm start` | Production: `node dist/index.js` |
| `npm run check` | `tsc --noEmit` (strict typecheck for client, server and shared) |
| `npm test` | `vitest run` (server tests only, see section 12) |
| `npm run format` | Prettier over the repo |
| `npm run db:push` | Drizzle generate and migrate. **Currently unused**, the DB layer is in-memory (section 13) |

---

## 3. Environment variables

Create `.env` in the repo root (it is git-ignored; never commit it). `envDir` is the repo root, so both server and client read the same file; only `VITE_*` keys reach the browser.

### Server

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_AI_KEY` | No (recommended) | Gemini API key. Missing means rule-based fallbacks for every agent |
| `GEMINI_MODEL` | No | Override model. Default `gemini-2.0-flash`. Set e.g. `gemini-2.5-flash` if the default is retired |
| `PORT` | No | Default `3000`. In production the server binds **strictly** to this (Railway injects it); in dev it scans upward for a free port |
| `NODE_ENV` | Yes in prod | `development` (Vite middleware, auth bypass) or `production` (static files) |
| `BYPASS_AUTH` | No | `true` makes every request a guest user. Needed for the protected procedures when not in development |
| `DEMO_MODE` | No | `true` returns canned LLM responses for some schemas (`server/_core/llm.ts`) |
| `JWT_SECRET`, `VITE_APP_ID`, `OAUTH_SERVER_URL`, `OWNER_OPEN_ID`, `DATABASE_URL`, `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` | No | Leftovers of the Manus hosting scaffold (OAuth, storage, forge). Unused by the demo flow |

### Client (build-time)

| Variable | Purpose |
|---|---|
| `VITE_BACKEND_URL` | Absolute URL of the API/Socket server when the client is hosted elsewhere (Vercel). Trailing slash is stripped. Empty means same origin |
| `VITE_MAPBOX_TOKEN` | Mapbox GL token for `Heatmap2D`, which no route mounts yet (section 9.3), so currently unused |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps embed in `GeospatialMap`. Missing falls back to a keyless satellite embed |
| `VITE_OAUTH_PORTAL_URL`, `VITE_FRONTEND_FORGE_API_URL`, `VITE_FRONTEND_FORGE_API_KEY` | Manus scaffold leftovers |

---

## 4. Architecture

```
┌────────────────────────────── Browser (React 19 + Vite) ───────────────────────────┐
│  Landing ─ HowItWorks ─ CommandCenter(Home)                                         │
│                              │        ▲                                            │
│            tRPC (HTTP, typed)│        │ Socket.io (push)                           │
│  MRUTwin (R3F) ◄─ spreadHeatmap, wind, isCritical ◄─ Home state                    │
└──────────────────────────────┼────────┼────────────────────────────────────────────┘
                               ▼        │
┌─────────────────────── Node.js / Express  (one process) ───────────────────────────┐
│  /api/trpc  ──► routers/emergency.ts, sustainability.ts                            │
│  /health, static client (prod) or Vite middleware (dev)                            │
│  Socket.io  ◄── _core/socket.ts  (broadcast* helpers)                              │
│                                                                                    │
│  agent/monitor.ts  ── 2 s tick, state machine ──► agent/orchestrator.ts (LLM agents)│
│        │                    │                          │                           │
│        │                    ▼                          ▼                           │
│        │            agent/spread.ts           _core/llm.ts ──► Gemini (or fallback) │
│        ▼            (cellular automaton)                                           │
│  pathfinding.ts (A*, slope-aware, 4 route types)                                   │
│        ▼                                                                           │
│  db.ts  ── in-memory store (incidents, zones, resources, FireCommand state)        │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Key ideas:

- **One process, one port.** Express hosts tRPC, Socket.io and the client. In production the client can alternatively live on Vercel and point at the backend with `VITE_BACKEND_URL`.
- **Server-authoritative simulation.** The browser never computes fire or routes. `monitor.ts` advances a single `FireCommandState` and pushes it over Socket.io; tRPC is for commands and for a state snapshot on load.
- **Graceful degradation everywhere.** No LLM key, no map token, no WebGL, no texture file: each degrades to a fallback instead of crashing.
- **End-to-end types.** `AppRouter` is exported from `server/routers.ts`; the client imports the type only.

---

## 5. Repository layout

```
client/
  index.html                  Fonts, meta, theme-color
  public/textures/            map_texture.png (ground texture; optional, falls back to flat colour)
  src/
    main.tsx                  tRPC + React Query providers
    App.tsx                   Routes (wouter), lazy Home, ErrorBoundary, Toaster
    index.css                 Tailwind v4 theme, design tokens, shared utilities (section 10)
    pages/
      Landing.tsx             Marketing page + simulated console preview
      HowItWorks.tsx          Agent list + SDG cards
      Home.tsx                Command Center dashboard (the app)
      NotFound.tsx
      ComponentShowcase.tsx   shadcn kitchen sink (not routed, dev reference only)
    components/
      landing/                ScrollStory.tsx (scroll-driven motion), storyModel.ts (pure logic)
      visualization/          MRUBuilding3D.tsx (3D twin), GeospatialMap.tsx (both mounted), Heatmap2D.tsx (Mapbox, not mounted)
      Campus3D.tsx            Terrain/campus 3D view (not mounted by any route)
      ui/                     shadcn/ui primitives (Radix + Tailwind)
      ErrorBoundary.tsx (mounted). AlertBanner, DemoMode, EmergencyReport, AIChatBox, DashboardLayout: unmounted (section 13)
    contexts/                 SocketContext (socket.io-client), ThemeContext
    hooks/                    useSocket, useMobile, useComposition, usePersistFn
    lib/                      trpc client, notifications, utils (cn)
server/
  _core/                      Framework: index (boot), socket, llm, trpc, context, vite, env, oauth, sdk, map, ...
  agent/
    monitor.ts                The state machine + 2 s loop (the heart of the app)
    orchestrator.ts           The LLM agents (6 functions) with fallbacks
    decision.ts               Single "what do we do now" decision with rule-based fallback
    spread.ts                 Cellular-automata fire spread (wind, barriers)
    rag.ts                    Nearest-zone knowledge retrieval for prompts
    policy.ts                 SDG policy brief generator
  pathfinding.ts              A* with slope, blocked zones, 4 typed routes
  routers/                    emergency.ts (main API), sustainability.ts
  db.ts                       In-memory data layer (name kept from an earlier DB design)
  *.test.ts                   Vitest suites
shared/                       Constants and types used by client and server
drizzle/, drizzle.config.ts   Schema scaffold (not wired, see section 13)
railway.json, vercel.json     Deploy config
.env.example                  Documented variables (no secrets)
```

Legacy files in the root (`1.txt`, `2.txt`, `3_MODULE_INTEGRATION_REALTIME_SCENARIO.txt`, `ANTI_GRAVITY_PLAYBOOK_COMPLETE.txt`, `HACKATHON_SPRINT_GUIDE.md`, `PITCH_STRATEGY.md`, `todo.md`, `stitch.html`, `test_browser.js`, `vite.config.ts.bak`, `.manus-logs/`) are hackathon notes and scratch artefacts. They are not used by the build. Consider moving them to `docs/` or deleting them.

Path aliases: `@` is `client/src`, `@shared` is `shared/`.

---

## 6. Backend

### 6.1 Coordinate frame (important)

Everything spatial shares **one world frame: x/y in metres, origin at the campus centre**. The pathfinder grid and the exits cover -250..250 (10x10 cells of 50 m, `cellIdx = floor((v + 250) / 50)`); campus zones are the centres of those same 10x10 cells; the fire-spread grid covers the central -150..150 m (60x60 cells of 5 m). If you add a spatial feature, stay in this frame. (An earlier version mixed 0..500 and -250..250, which made three of four exits unreachable.)

One wart remains: `triggerFireCommand` stores the incident as `locationX=0, locationY=12, locationZ=20`, while the monitor ignites the fire and starts routes from ground point `(0, 20)`, and the zone/route helpers read `locationX/locationY`. Do not trust `locationY` for 2D lookups until this is unified.

Exits: `(250,250)` North, `(-250,250)` West, `(250,-250)` East, `(-250,-250)` South assembly points.

### 6.2 The monitor loop and phases

`agent/monitor.ts` runs a 2 s tick (re-entrancy guarded, idempotent start/stop, stale ticks are dropped if state changed mid-await). `triggerFireCommand` creates the state; the loop advances `state.phase`:

| Phase | Agent / logic | Output |
|---|---|---|
| `DETECTING` | `agentSensorFusion` | Confirms the fire, confidence, location |
| `SPREADING` | `agentSpreadPredictor` + `simulateSpread` | Spread direction, evac window, heatmap (`spread_update`) |
| `ROUTING` | `agentEvacuationPlanner` + `pathfinder.compute4Routes` | Four routes with ETAs; vulnerable-person triage |
| `DISPATCHING` | `agentResourceAllocator` | Ambulances, medical teams, fire units |
| `BROADCASTING` | `agentBroadcast` | Multi-channel alert, sent/seen counters |
| `MONITORING` | Plain code in `monitor.ts` (the "HealthMonitor" agent, no LLM) | Evacuation progress, vitals, SDG scores. **Progress is generated**: +80-120 evacuees per tick and random status changes for vulnerable people, not telemetry |
| `COMPLETE` | | Final metrics; `IDLE` before a trigger |

Every phase appends to `agent_log` (agent, phase, result, timestamp), shown live in the dashboard. A second trigger or a reset clears incidents and resets resources and vulnerable-person statuses, so runs are repeatable.

What is real and what is placeholder: the spread heatmap, the four routes and their ETAs come from the physics/pathfinding code; agent text comes from Gemini (or the fallbacks). The fire always ignites at ground point `(0, 20)` (the `zone` argument of `triggerFireCommand` is only a label; wind is the only parameter that changes the simulation). Evacuation counts, broadcast sent/seen counts and vulnerable-person status changes in `MONITORING` are randomised increments, and on completion `casualties` is set to 0 and the SDG 13 score to 100. These are demo values, not computed outcomes.

### 6.3 Agents and LLM access

`orchestrator.ts` exposes six agents (`SensorFusion`, `SpreadPredictor`, `EvacuationPlanner`, `VulnerabilityTriage`, `ResourceAllocator`, `Broadcast`) plus `decision.ts` and `policy.ts`. The seventh agent shown on the How-It-Works page, `HealthMonitor`, is the plain-code `MONITORING` phase. `decision.ts` (`makeDecision`) is not part of the monitor loop: it runs when an incident is created through `createIncident` / `reportVoiceIncident` and emits `ai_decision`. All LLM calls go through `_core/llm.ts`:

- 25 s fetch timeout (`AbortSignal.timeout`), API key read lazily.
- `parseLLMJson` tolerates code fences and prose around JSON.
- LLM output is treated as untrusted: enums validated, numbers coerced and clamped (confidence, ETA, window).
- On any failure the agent returns a deterministic fallback, so the pipeline always completes.

### 6.4 Fire spread (`agent/spread.ts`)

A deterministic cellular automaton (no randomness) on a 60x60 grid of 5 m cells, one step per simulated minute. Every cell with intensity >= 0.1 pushes `intensity x rate` into each of its 8 neighbours (capped at 1). `rate = 0.15 + wind alignment x 0.25`: wind blowing *from* `direction_deg` pushes fire the opposite way, faster downwind and slower upwind; diagonals are x0.7; an uphill bonus applies if an elevation grid is passed (the monitor passes none). Two hard-coded road discs act as barriers. Inputs are sanitised (NaN, negative or >=360 degrees). Flat `Float64Array` double buffers and a precomputed barrier mask mean there are **no per-step allocations**. Output: `{ spread_direction, evac_window_minutes, heatmap: [{x, y, intensity, timeToReach}], grid }`; the monitor keeps the 200 most intense cells.

### 6.5 Pathfinding (`pathfinding.ts`)

A* over the 10x10 grid with synthetic terrain elevation. Cost = traversal time (speed depends on slope: steep uphill is half speed, downhill faster) + an elevation penalty. Cells inside active incidents are **not walls**, they carry a 1000 s penalty, so an evacuee starting inside the hazard can still escape. `findPath` resets all cell state each call (the instance is shared).

`compute4Routes(x, y, heatmap?)` runs one A* per exit and picks four views of the same candidates:

| Type | Selection |
|---|---|
| `fastest` | Minimum travel time |
| `safest` | Highest *mean* clearance from the predicted-fire heatmap |
| `accessible` | Smallest steepest-segment slope; description states the real slope and whether it is within 5 degrees; ETA x1.3 for slower pace |
| `low_crowd` | Fastest exit **not** already used by the other three; falls back to any other exit |

`eta_min: 0` means no route was found (never "fastest").

### 6.6 Data layer (`db.ts`)

Pure in-memory arrays (incidents, campus zones, evacuation routes, resources, vulnerable people, FireCommand state). Zones are a 10x10 grid of 50 m cells whose centres are in the world frame. State is lost on restart; see section 13.

### 6.7 Security notes

- CORS is `*` (demo). Restrict to the Vercel origin before any real deployment.
- Input bounds: zone length, wind direction 0..360, wind speed 0..100, incident text lengths (they flow into LLM prompts).
- `protectedProcedure` requires a session; in `development` or with `BYPASS_AUTH=true` every caller is a guest. In production without bypass those procedures need the (Manus) OAuth flow, which is not set up.
- Never commit `.env`. It is git-ignored.

---

## 7. Realtime contract (Socket.io)

Server to client only (clients never emit). On connect the server immediately sends the latest `firecommand_update`, so reloads and late joiners are in sync. Client code: `contexts/SocketContext.tsx` (and `Home.tsx` for dashboard-specific listeners). Always unregister with the **same handler reference** (`socket.off(evt, handler)`); calling `off(evt)` alone removes every listener for that event.

| Event | Payload | Meaning |
|---|---|---|
| `firecommand_update` | Full `FireCommandState`, or `null` after reset | Authoritative state snapshot each tick |
| `spread_update` | `{ heatmap: Array<{x, y, intensity, timeToReach}>, evac_window, spread_direction, step }` | Fire-spread heatmap (top 200 cells) for the 3D twin |
| `evac_progress` | `{ evacuated, total, timer }` | Evacuation counters |
| `vitals_update` | `{ green, yellow, red }` | Triage summary |
| `broadcast_status` | `{ sent, seen, target }` | Alert delivery progress |
| `ai_decision` | Decision object | Emitted when an incident is created via `createIncident` / `reportVoiceIncident` (not by the monitor loop); shown as a toast |
| `new_incident` | Incident | Toast + browser notification |
| `incident_resolved` | Incident id or `"ALL"` | Clears incident UI |

---

## 8. API reference (tRPC)

Mounted at `/api/trpc`. Router: `appRouter = { system, auth, emergency, sustainability }`. Client: `client/src/lib/trpc.ts` (`trpc.emergency.*`). *Public* means no session needed.

### `emergency`

| Procedure | Kind | Auth | Purpose |
|---|---|---|---|
| `triggerFireCommand({ zone, wind_direction_deg, wind_speed_mps })` | mutation | public | Resets entities, clears old incidents, creates state + one incident, broadcasts both |
| `getFireCommandState` | query | public | Current state snapshot (used on load and as a poll fallback if the socket is down) |
| `resetFireCommand` | mutation | public | Clears state, incidents, resources; broadcasts reset |
| `createIncident`, `reportVoiceIncident`, `uploadAudio` | mutation | protected | Manual / voice-reported incidents (voice goes through `_core/voiceTranscription`, then LLM parsing coerced to enums). These also run `makeDecision` and emit `ai_decision` |
| `getActiveIncidents` | query | public | Open incidents |
| `resolveIncident`, `clearAllIncidents` | mutation | protected | |
| `getCampusZones`, `getZoneSeverity` | query | public | Zone grid and per-zone severity |
| `calculateEvacuationRoutes({ buildings })` | query | public | A* routes from the given buildings to every exit, with active incidents as hazards |
| `runFireCommandScenario({ incidentId? })` | query | public | Returns a **canned demo snapshot** (fixed confidence 0.97, 700/700 evacuated, 668 seen, 7 min) merged with live routes, resources and triage from the store. It does not run the live pipeline |
| `getHeatmap` | query | public | Per-zone severity (`info` / `warning` / `critical`) from distance to active incidents with a wind factor. Not the spread-simulation heatmap, which arrives via `spread_update` |

### `sustainability`

`getPolicyBrief` (public): SDG policy brief from run metrics (template fallback without LLM key).

### `system` and `auth`

`system.health` (public), `system.notifyOwner` (admin), `auth.me` (the session user, or a guest admin), `auth.logout`.

---

## 9. Frontend

Stack: React 19, Vite 7, TypeScript, Tailwind CSS v4, shadcn/ui (Radix), wouter, TanStack Query + tRPC, socket.io-client, React Three Fiber + drei + three, Mapbox GL, framer-motion, jsPDF, sonner.

### 9.1 Routing and code splitting

`App.tsx` defines routes. `Home` (the dashboard) is `React.lazy` so three.js, Mapbox and jsPDF stay out of the landing bundle. `SocketProvider` wraps **only** `/command-center`, so the landing page opens no socket. Vendor chunks are split in `vite.config.ts` (`vendor-three`, `vendor-pdf`, plus a `vendor-maps` rule that only yields a chunk once Mapbox/Google Maps code is actually imported); Home itself is ~22 kB gzipped.

### 9.2 Command Center (`pages/Home.tsx`)

- Syncs from `getFireCommandState` on mount, then follows socket events; polls every 3 s only if the socket is down during an active incident.
- Mission strip: phase, elapsed, evacuated x/700, vulnerable safe, LIVE/OFFLINE chip.
- Panels: Agent thinking log (`role="log"`), Phase tracker, SDG 13 climate, Incident summary, 4 evacuation routes, Vulnerable priority board, Resource dispatch, Broadcast console, SDG impact scorecard, "Without FireCommand (modeled)" (an assumption, labelled as such), and a PDF report (jsPDF, loaded on demand).
- The audio alarm uses one `AudioContext` created inside the click that triggers the run (browser autoplay rules) and closed on unmount.
- The 3D area and map are wrapped in error boundaries; a WebGL failure does not take the app down.

### 9.3 The 3D digital twin (`visualization/MRUBuilding3D.tsx`)

Use the self-contained **`<MRUTwin />`** (canvas + camera + controls + error boundary + overlays):

```tsx
<MRUTwin
  isCritical={isCritical}
  scenario={isCritical ? "TEST_CASE_3" : null}
  spreadHeatmap={spreadHeatmap}          // Array<{x, y, intensity}>, world frame
  wind={{ direction_deg, speed_mps }}
/>
```

What it renders: a four-floor glass-style building (rooms, slabs, columns, mullions, stairwells, roof solar panels, beacon), ground and city skyline, GPU shader fire and smoke that grow with fire age and drift with wind, two animated glowing evacuation routes with 30 instanced evacuees, a responder route, ceiling detector markers, hemisphere + shadow-casting directional + rim lights, fog, a procedural environment (no network fetch).

How it explains itself (`showOverlay`, default on):

- **"How to read" legend** (top-right, collapsed by default on narrow screens): colour meaning for safe / smoke / fire / exit / route.
- **Info panel** (bottom-left): hover or tap rooms, stairwells, floors, assembly points, landmarks and sensors for a plain-language description.
- A visible note that fire, smoke, occupancy, AQI and evacuees are **simulated**; spread tiles are labelled live only when `spreadHeatmap` is supplied.
- Clicking a room *selects* it; "Simulate fire here" / "Clear fire" are explicit buttons, so orbit-dragging cannot ignite anything.

Performance and resilience: instanced meshes (evacuees, trees, columns, mullions, spread tiles), no per-frame allocations, DPR capped at 1.75 (1.25 low power) with `PerformanceMonitor`, `frameloop="never"` when off-screen, WebGL context-loss handling, half particle count and smaller shadow map on mobile, reduced-motion disables auto-rotate, textures disposed on unmount, missing `map_texture.png` falls back to a flat ground colour. No `postprocessing` dependency is installed, so there are no post effects.

Other visualisations: `GeospatialMap` (mounted by the dashboard: satellite embed, optional `isCritical`). `Campus3D` (slope-coloured terrain, labelled buildings, routes; shares the `FireEffect` / `GlowRoute` exports) and `Heatmap2D` (Mapbox heat layer; token or WebGL failures show a message) are finished but **not mounted by any route yet**.

### 9.4 Landing page and scroll motion

`pages/Landing.tsx`: sticky nav, hero, **simulated** console preview that loops through the incident phases (labelled SIMULATED, pauses in hidden tabs, static final frame under reduced motion), pipeline, features, SDG cards, impact, CTA, footer. Claims are worded as simulated or modeled; keep them honest.

`components/landing/ScrollStory.tsx` ("From first spark to safe evacuation"): lazy-loaded; a 500svh section with a sticky 100svh stage.

- Scroll progress (0 to 1) is the **only** driver. One passive scroll listener behind a `requestAnimationFrame` throttle, attached by an `IntersectionObserver` only while on screen. Scrolling back un-burns the fire.
- Steps: detect (0-0.16), spread (0.16-0.38), decide / agent pipeline + typed log (0.38-0.60), route draw + moving people (0.60-0.85), all clear + counters (0.85-1).
- `storyModel.ts` holds the pure model (floor plan, deterministic fire cells, routes, timeline).
- Reduced motion: no sticky, no tall section; renders the static final composition.
- Constraint: **no ancestor may be `overflow: hidden/auto/scroll`** or `position: sticky` breaks. The page root uses `overflow-x: clip`, which is safe. The stage has `pt-16` so it clears the sticky nav.

---

## 10. Design system and CSS

Tailwind CSS **v4**, configured in CSS (no `tailwind.config.js`). Everything lives in `client/src/index.css`. Language: dark, near-black navy "emergency command" with fire-red alerts and cyan/green for safe states.

### 10.1 Tokens (`@theme`)

| Token | Value | Use (Tailwind class) |
|---|---|---|
| `--color-fc-bg` | `#020617` | Page background (`bg-fc-bg`) |
| `--color-fc-panel` | `#010613` | Cards/panels (`bg-fc-panel`) |
| `--color-fc-cyan` | `#0dccf2` | Primary / interactive / "monitoring" (`text-fc-cyan`) |
| `--color-fc-red` | `#ff003c` | Fire, critical, alerts (`border-fc-red/30`) |
| `--color-fc-green` | `#00ffaa` | Safe, routes, success |
| `--color-fc-amber` | `#ff9900` | Warning, smoke |
| `--color-fc-violet` | `#a855f7` | AI / agent accents |
| `--font-display` | Space Grotesk | Headings |
| `--font-sans` | Inter | Body |
| `--font-mono` | JetBrains Mono | Logs, eyebrows, numbers |

Fonts load from Google Fonts in `client/index.html`. shadcn semantic variables (`--primary`, `--background`, `--radius`, ...) are defined in `:root` and the dark scope; in dark mode `--primary` is cyan, so default shadcn buttons are cyan app-wide. App default theme is dark (`ThemeProvider defaultTheme="dark"`).

### 10.2 Shared utilities

| Class | Purpose |
|---|---|
| `.fc-hero-bg` | Layered red/cyan radial glow for the hero |
| `.fc-eyebrow` | Mono, uppercase, wide-tracked section label |
| `.reveal` / `.reveal.is-in` | Scroll-reveal: opacity + 14 px translate only |
| `.fc-caret` | Blinking caret for typed text |
| `.cyber-btn`, `.cyber-btn-alert`, `.cyber-text` | Dashboard "cyber" look. Headings are **not** forced cyan/uppercase globally; opt in with `.cyber-text` |
| `alert-flash-red`, `scan`, `glitch*`, `red-alert` keyframes | Critical-state body flash and scanline overlay (kept subtle) |

### 10.3 Conventions

- **Compose with tokens, not hex**: `bg-fc-panel text-fc-cyan border-fc-red/30`. The few hex values left in SVG/Three code are intentional (no CSS there).
- **Motion**: animate `transform` and `opacity` only; no layout-thrashing properties. Every animation must respect `prefers-reduced-motion` (a global block shortens animations; JS-driven ones such as `ScrollStory` and the Landing preview check `matchMedia` and render a static end state).
- **Accessibility**: minimum text size 11 px, body text slate-300/400 or lighter on the dark panels, `aria-label`s on icon buttons, `role="log"` on the agent log, `role="alert"` on the alert banner, skip link on Landing, `aria-current` on step trackers, pinch-zoom enabled (do not re-add `maximum-scale`).
- **Responsive**: 16 px side gutters, no horizontal scroll at phone width, command panels stack above the 3D view on small screens.
- **Components**: add shadcn primitives via `components.json` conventions; keep project-specific UI out of `components/ui/`.

---

## 11. Deployment

### Option A: single service (simplest) on Railway

`railway.json` uses Nixpacks, start command `npm start`, health check `/`.

1. New Railway project from the GitHub repo.
2. Variables: `NODE_ENV=production`, `GOOGLE_AI_KEY`, `VITE_GOOGLE_MAPS_API_KEY` (optional), and `BYPASS_AUTH=true` if you need the protected procedures without OAuth (demo only). `VITE_MAPBOX_TOKEN` is only needed once `Heatmap2D` is mounted.
3. Build runs `npm run build` (note: `VITE_*` values must exist **at build time**). The server serves `dist/public` and the API from one URL.

### Option B: split (Railway API + Vercel client)

- Railway: as above (API, Socket.io, agents).
- Vercel: `vercel.json` builds with `npm run build:client`, output `dist/public`, SPA rewrite to `index.html`. Set `VITE_BACKEND_URL=https://<your-railway-app>` (no trailing slash needed) plus the Google Maps key (and Mapbox if you mount `Heatmap2D`). Restrict CORS on the server to the Vercel origin.

The server must stay a **single long-lived instance** (state is in memory and the loop runs in-process). Do not scale horizontally or use serverless for the backend.

---

## 12. Testing and verification

Run before every handoff or PR:

```bash
npm run check   # tsc --noEmit, must be clean
npm test        # vitest, server suites
npm run build   # client + server bundle
```

Current suites (`server/**/*.test.ts`, 22 tests): pathfinding behaviour, `emergency` router, auth logout, and `simulation.test.ts` regressions (all four exits reachable incl. negative coordinates, repeated searches cannot loop, blocked start can escape, four routes have real ETAs and `low_crowd` differs from `fastest`, spread direction with bad input).

Not covered: there are **no client tests** and no browser E2E (`vitest.config.ts` includes server files only). The 3D twin, landing animations and dashboard were verified by typecheck and build, not by automated visual tests. A Playwright smoke test (landing, trigger, assert the log fills) would be the highest-value addition.

---

## 13. Known limitations and handoff notes

1. **In-memory data.** `server/db.ts` is not a database. State resets on every restart and cannot be shared across instances. Drizzle files exist but are not wired. If persistence is needed, replace `db.ts` function by function (the exported function signatures are the contract) and wire `drizzle.config.ts`.
2. **Simulated world.** Sensors, occupancy (700 people, 33 vulnerable), fire, AQI and evacuees are generated. The UI labels this; keep the labels when you extend it. The "18 min / 24 casualties without FireCommand" baseline is a modeled assumption, not a measurement.
3. **Auth.** `protectedProcedure` is open in development / `BYPASS_AUTH`, and otherwise depends on the Manus OAuth scaffold (`server/_core/oauth.ts`, `sdk.ts`) which is not configured. Decide on a real auth story before exposing write endpoints.
4. **Open CORS** (`*`) in both Express and Socket.io.
5. **Gemini model.** Default `gemini-2.0-flash`; if retired, set `GEMINI_MODEL`.
6. **Single-incident model.** The dashboard and monitor handle one active FireCommand run at a time.
7. **No client tests / visual regression** (section 12).
8. **Bundle size.** `vendor-three` (~335 kB gzip) loads with `/command-center`; `vendor-pdf` (~174 kB gzip) only when a PDF report is generated.
9. **Scaffold leftovers.** The Manus OAuth/forge variables and `server/_core/{oauth,sdk}.ts` (auth) come from the hosting template. `server/_core/{map,dataApi,imageGeneration}.ts`, `server/storage.ts` (only imported by `imageGeneration`) and `components/ManusDialog.tsx` are imported by nothing and look safe to delete after your own check. `voiceTranscription` is **in use** (`reportVoiceIncident`); `notification` is used by `system.notifyOwner`.
10. **Unmounted components.** `DemoMode`, `AlertBanner`, `EmergencyReport`, `DashboardLayout`, `Campus3D`, `Heatmap2D` and the `ComponentShowcase` page are maintained but not reachable from any route (`AIChatBox` is only used by the showcase).
11. **Repo hygiene.** Legacy notes in the repo root (section 5) should move to `docs/` or be deleted. `dist/` is git-ignored (local build output).
12. **Browser notifications** are requested on the first user click on `/command-center` (not on connect), because gesture-less prompts are ignored by browsers.
13. **Generated numbers.** MONITORING progress, broadcast sent/seen counts and vulnerable-person status changes are randomised increments; `casualties` and the SDG 13 score are fixed on completion; `runFireCommandScenario` returns canned figures (section 6.2, section 8). Replace these with real inputs before presenting any number as a measurement.
14. **Fixed ignition point.** The fire always starts at ground point `(0, 20)`; `triggerFireCommand.zone` is a label. Parameterise the ignition point (and fix the `locationY` wart in section 6.1) if you want selectable origins.

---

## 14. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `npm install` peer-dependency errors | Keep `.npmrc` (`legacy-peer-deps=true`) |
| Dashboard shows OFFLINE | Socket cannot reach the backend. Same origin: is the server running? Split deploy: check `VITE_BACKEND_URL` was set at **build** time and CORS allows the origin |
| Agents all say "fallback" / generic text | `GOOGLE_AI_KEY` missing or invalid, or the model was retired (`GEMINI_MODEL`) |
| Server logs "Could not find the build directory" and pages return errors | Run `npm run build` first (`dist/public` must exist), then `npm start` or `npm run host`. Use `npm run dev` while developing |
| Protected mutation returns "Please login (10001)" | Not in development and no `BYPASS_AUTH=true` |
| 3D view blank | WebGL unavailable or context lost: the twin shows a message / error boundary instead of crashing. Try another browser or enable hardware acceleration |
| Map panel shows a keyless satellite embed | `VITE_GOOGLE_MAPS_API_KEY` was not set at build time |
| Boot log shows `[OAuth] ERROR: OAUTH_SERVER_URL is not configured` | Expected without the Manus OAuth scaffold; harmless for the demo. `dotenv` never overrides variables already set in your shell |
| Second trigger seems to do nothing | It resets and restarts the run; check the agent log for the new `DETECTING` entry |
| ScrollStory does not pin | An ancestor has `overflow: hidden/auto/scroll`. Use `overflow: clip` if you need to hide overflow |

---

*Hackathon 2026. SDG 11 (Sustainable Cities), SDG 13 (Climate Action), SDG 3 (Good Health).*
