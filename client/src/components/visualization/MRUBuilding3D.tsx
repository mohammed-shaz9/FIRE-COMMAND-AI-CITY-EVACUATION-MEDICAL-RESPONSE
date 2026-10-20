import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Edges, Environment, Grid, Html, Lightformer, Line, OrbitControls, PerformanceMonitor, Stars } from '@react-three/drei';
import * as THREE from 'three';

/* ───────────────────────── public API ───────────────────────── */

export interface SpreadCellLite { x: number; y: number; intensity: number }
export interface MRUBuilding3DProps {
  onIncidentTriggered?: () => void;
  isCritical?: boolean;
  scenario?: string | null;
  /** optional live SpreadPredictor cells (backend metres; ignition (0,20) maps to Room 302) */
  spreadHeatmap?: SpreadCellLite[];
  /** optional wind (blows FROM direction_deg); smoke drifts the opposite way */
  wind?: { direction_deg: number; speed_mps: number } | null;
  /** HTML legend + info overlay (default true) */
  showOverlay?: boolean;
}

/* ───────────────────────── model constants ───────────────────────── */

const STOREY = 12;
const ROOM_W = 20, ROOM_D = 20, ROOM_H = 11;
const ROOM_X = [-30, -8, 14];
const ROOM_Z = -10;
const STAIR_X = { W: -50, E: 46 } as const;
const FLOORS = [1, 2, 3, 4];
const y0 = (f: number) => (f - 1) * STOREY; // slab bottom of floor f
const CYAN = '#0dccf2', GREEN = '#00ffaa', RED = '#ff003c', ORANGE = '#ff9900';

type RState = 'safe' | 'smoke' | 'fire';
const rid = (f: number, i: number) => `room-${f}0${i + 1}`;
const parseRid = (id: string) => ({ f: +id[5], i: +id[7] - 1 });

function mulberry(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// deterministic simulated occupancy (no Math.random in render)
const occupancyOf = (f: number, i: number, scenario?: string | null) =>
  scenario === 'HOUSING_STRESS' && f === 4 ? 95 : 20 + Math.floor(mulberry(f * 31 + i * 7)() * 30);

const ROUTE_A = [[-50, 49, -10], [-50, 1.9, -10], [-50, 0.9, 8], [-72, 0.9, 28], [-90, 0.9, 42]] as const;
const ROUTE_B = [[46, 49, -10], [46, 1.9, -10], [46, 0.9, -28], [74, 0.9, -44], [90, 0.9, -60]] as const;
const ROUTE_RESP = [[-250, 0.9, 200], [-150, 0.9, 200], [-150, 0.9, 20], [-62, 0.9, 14]] as const;
const toV = (a: readonly (readonly number[])[]) => a.map(p => new THREE.Vector3(p[0], p[1], p[2]));
const PA = toV(ROUTE_A), PB = toV(ROUTE_B), PR = toV(ROUTE_RESP);

const LANDMARKS = [
  { id: 'lm-fire', name: 'FORTRESS FIRE DEPT', pos: [-250, 0, 200] as const, color: RED, text: 'Responder origin. Orange route shows the engine approach to the building.' },
  { id: 'lm-hosp', name: 'CITY HOSPITAL EXPRESS', pos: [350, 0, -250] as const, color: GREEN, text: 'Casualty transfer site for triage.' },
  { id: 'lm-cd', name: 'CIVIL DEFENSE BASE', pos: [0, 0, -500] as const, color: GREEN, text: 'Civil defense coordination base.' },
];

/* ───────────────────────── helpers ───────────────────────── */

function isLowPower() {
  if (typeof navigator === 'undefined') return false;
  return /Mobi|Android/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4;
}

/** Texture load that can never throw/suspend: returns null on failure. Disposes on unmount. */
function useSafeTexture(url: string, repeat = 2) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let dead = false;
    let t: THREE.Texture | null = null;
    new THREE.TextureLoader().load(
      url,
      (loaded) => {
        if (dead) { loaded.dispose(); return; }
        loaded.wrapS = loaded.wrapT = THREE.RepeatWrapping;
        loaded.repeat.set(repeat, repeat);
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.anisotropy = 4;
        t = loaded; setTex(loaded);
      },
      undefined,
      () => { if (!dead) console.warn('[MRUBuilding3D] texture failed, using flat ground:', url); },
    );
    return () => { dead = true; t?.dispose(); };
  }, [url, repeat]);
  return tex;
}

/** Tiny error boundary so decorative parts (env, textures) can never take the page down. */
class SafeBoundary extends React.Component<{ children: React.ReactNode; fallback?: React.ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(e: unknown) { console.warn('[MRUBuilding3D] part failed:', e); }
  render() { return this.state.err ? (this.props.fallback ?? null) : this.props.children; }
}

/* ───────────────────────── fire (GPU particles, zero per-frame allocation) ───────────────────────── */

const FIRE_VS = /* glsl */`
attribute vec4 aSeed; uniform float uTime, uPx, uHeight, uSize, uSmoke, uLevel; uniform vec3 uArea; uniform vec2 uWind;
varying float vLife;
void main(){
  float life = fract(aSeed.x + uTime * (0.22 + aSeed.y * 0.3));
  vec3 p = vec3((aSeed.y - 0.5) * uArea.x, 0.0, (aSeed.z - 0.5) * uArea.z);
  p.y = life * uHeight * (uSmoke > 0.5 ? 1.0 : (0.55 + 0.45 * uLevel));
  p.x += sin(uTime * 2.0 + aSeed.w * 20.0) * 1.3 * life + uWind.x * life * life * uHeight * 0.7;
  p.z += cos(uTime * 1.7 + aSeed.w * 17.0) * 1.3 * life + uWind.y * life * life * uHeight * 0.7;
  vLife = life;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float grow = uSmoke > 0.5 ? (0.7 + life * 2.2) : (1.0 - life * 0.65);
  gl_PointSize = uSize * uPx * grow * (0.6 + aSeed.w * 0.8) * (0.5 + 0.5 * uLevel) / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FIRE_FS = /* glsl */`
varying float vLife; uniform float uSmoke, uAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  vec3 col;
  if (uSmoke > 0.5) { col = vec3(0.16, 0.15, 0.15); a *= (1.0 - vLife) * 0.55 * uAlpha; }
  else { col = mix(vec3(1.0, 0.82, 0.22), vec3(0.95, 0.12, 0.02), vLife); a *= (1.0 - vLife) * uAlpha; }
  gl_FragColor = vec4(col, a);
}`;

function ParticleColumn({ smoke, count, area, height, level, wind, size }: {
  smoke: boolean; count: number; area: [number, number, number]; height: number; level: number; wind: [number, number]; size: number;
}) {
  const geo = useMemo(() => {
    const r = mulberry(smoke ? 11 : 7);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = r();
    return { pos: new Float32Array(count * 3), seed };
  }, [count, smoke]);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 }, uPx: { value: 400 }, uHeight: { value: height }, uSize: { value: size }, uSmoke: { value: smoke ? 1 : 0 },
    uLevel: { value: level }, uArea: { value: new THREE.Vector3(...area) }, uWind: { value: new THREE.Vector2(wind[0], wind[1]) }, uAlpha: { value: 1 },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  useFrame((s) => {
    uniforms.uTime.value = s.clock.elapsedTime;
    uniforms.uPx.value = s.size.height * s.viewport.dpr * 0.5;
    uniforms.uLevel.value = level; uniforms.uHeight.value = height; uniforms.uWind.value.set(wind[0], wind[1]);
  });
  return (
    <points frustumCulled={false} renderOrder={smoke ? 2 : 3}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geo.pos, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[geo.seed, 4]} />
      </bufferGeometry>
      <shaderMaterial vertexShader={FIRE_VS} fragmentShader={FIRE_FS} uniforms={uniforms} transparent depthWrite={false} fog={false}
        blending={smoke ? THREE.NormalBlending : THREE.AdditiveBlending} />
    </points>
  );
}

export function FireEffect({ position, level, wind, low }: { position: [number, number, number]; level: number; wind: [number, number]; low: boolean }) {
  return (
    <group position={position}>
      <ParticleColumn smoke={false} count={low ? 90 : 200} area={[ROOM_W * 0.8, 0, ROOM_D * 0.8]} height={14} level={level} wind={wind} size={7} />
      <ParticleColumn smoke count={low ? 50 : 110} area={[ROOM_W * 0.7, 0, ROOM_D * 0.7]} height={46} level={level} wind={wind} size={14} />
    </group>
  );
}

/* ───────────────────────── animated route ───────────────────────── */

export function GlowRoute({ points, color, active, flip = false }: { points: THREE.Vector3[]; color: string; active: boolean; flip?: boolean }) {
  const ref = useRef<any>(null);
  useFrame((_s, dt) => {
    const m = ref.current?.material;
    if (m) m.dashOffset += (flip ? 1 : -1) * dt * (active ? 6 : 1.5);
  });
  return (
    <group>
      <Line points={points} color={color} lineWidth={active ? 7 : 4} transparent opacity={active ? 0.22 : 0.08} toneMapped={false} depthWrite={false} />
      <Line ref={ref} points={points} color={color} lineWidth={active ? 2.6 : 1.4} dashed dashSize={3} gapSize={2.2} transparent opacity={active ? 1 : 0.45} toneMapped={false} depthWrite={false} />
    </group>
  );
}

/* ───────────────────────── evacuees (one InstancedMesh) ───────────────────────── */

interface Agent { path: THREE.Vector3[]; off: number; speed: number; route: 'A' | 'B' }

function buildAgents(): Agent[] {
  const r = mulberry(99);
  const out: Agent[] = [];
  const tailA = toV(ROUTE_A).slice(2), tailB = toV(ROUTE_B).slice(2);
  const add = (f: number, i: number, route: 'A' | 'B') => {
    const sx = route === 'A' ? STAIR_X.W : STAIR_X.E;
    const yf = y0(f) + 1.9, jz = (r() - 0.5) * 8;
    const start = new THREE.Vector3(ROOM_X[i] + (r() - 0.5) * 12, yf, ROOM_Z + (r() - 0.5) * 10);
    const sj = (r() - 0.5) * 4;
    const path = [start, new THREE.Vector3(sx + sj, yf, ROOM_Z + jz), new THREE.Vector3(sx + sj, 1.9, ROOM_Z + jz), ...(route === 'A' ? tailA : tailB).map(p => p.clone().add(new THREE.Vector3((r() - 0.5) * 3, 0, (r() - 0.5) * 3)))];
    out.push({ path, off: r() * 14, speed: 8 + r() * 3, route });
  };
  for (let k = 0; k < 10; k++) add(1 + (k % 2), k % 3, 'A');   // floors 1-2 -> west stairs
  for (let k = 0; k < 10; k++) add(4, k % 3, 'B');             // floor 4 -> east stairs
  for (let k = 0; k < 10; k++) add(3, k < 5 ? 0 : 2, k < 5 ? 'A' : 'B'); // floor 3 splits around the fire room
  return out;
}

function Evacuees({ agents }: { agents: Agent[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const data = useMemo(() => agents.map(a => {
    const cum = [0];
    for (let i = 1; i < a.path.length; i++) cum.push(cum[i - 1] + a.path[i].distanceTo(a.path[i - 1]));
    return { ...a, cum, total: cum[cum.length - 1] };
  }), [agents]);
  useLayoutEffect(() => {
    const m = ref.current; if (!m) return;
    const cA = new THREE.Color(CYAN), cB = new THREE.Color(GREEN);
    data.forEach((a, k) => m.setColorAt(k, a.route === 'A' ? cA : cB));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [data]);
  useFrame((s) => {
    const m = ref.current; if (!m) return;
    const t = s.clock.elapsedTime;
    for (let k = 0; k < data.length; k++) {
      const a = data[k];
      let u = ((t + a.off) % (a.total / a.speed + 2.5)) * a.speed;
      if (u > a.total) u = a.total;
      let j = 1;
      while (j < a.cum.length - 1 && a.cum[j] < u) j++;
      const f = (u - a.cum[j - 1]) / (a.cum[j] - a.cum[j - 1] || 1);
      const p0 = a.path[j - 1], p1 = a.path[j];
      dummy.position.set(p0.x + (p1.x - p0.x) * f, p0.y + (p1.y - p0.y) * f, p0.z + (p1.z - p0.z) * f);
      dummy.updateMatrix();
      m.setMatrixAt(k, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, agents.length]} frustumCulled={false}>
      <sphereGeometry args={[0.9, 10, 8]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/* ───────────────────────── building parts ───────────────────────── */

const STATE_STYLE: Record<RState, { color: string; emissive: string; ei: number; opacity: number; edge: string }> = {
  safe: { color: '#7dd3fc', emissive: '#0a3a52', ei: 0.15, opacity: 0.13, edge: CYAN },
  smoke: { color: '#6b7280', emissive: '#7c4a03', ei: 0.35, opacity: 0.5, edge: ORANGE },
  fire: { color: '#ff5a2a', emissive: '#ff1a00', ei: 1.6, opacity: 0.55, edge: RED },
};

interface HoverApi { onHover: (id: string | null) => void; onSelect: (id: string) => void }

const Room = memo(function Room({ id, f, i, state, hl, crowded, onHover, onSelect }: { id: string; f: number; i: number; state: RState; hl: boolean; crowded: boolean } & HoverApi) {
  const st = STATE_STYLE[state];
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const detRef = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    if (matRef.current && state === 'fire') matRef.current.emissiveIntensity = st.ei + Math.sin(t * 14 + i * 3) * 0.35;
    if (detRef.current && state === 'fire') detRef.current.opacity = Math.sin(t * 18) > 0 ? 1 : 0.2;
  });
  const cy = y0(f) + 1 + ROOM_H / 2;
  const edge = hl ? '#ffffff' : crowded && state === 'safe' ? ORANGE : st.edge;
  const detColor = state === 'fire' ? RED : state === 'smoke' ? ORANGE : GREEN;
  return (
    <group position={[ROOM_X[i], cy, ROOM_Z]}>
      <mesh onPointerOver={(e) => { e.stopPropagation(); onHover(id); }} onPointerOut={() => onHover(null)} onClick={(e) => { e.stopPropagation(); onSelect(id); }}>
        <boxGeometry args={[ROOM_W, ROOM_H, ROOM_D]} />
        <meshPhysicalMaterial ref={matRef} color={st.color} emissive={st.emissive} emissiveIntensity={hl ? Math.max(st.ei, 0.6) : st.ei}
          transparent opacity={hl ? Math.min(0.8, st.opacity + 0.2) : st.opacity} roughness={0.08} metalness={0.2} clearcoat={1} depthWrite={false} envMapIntensity={1.6} />
        <Edges threshold={20} color={edge} />
      </mesh>
      {/* floor tile glow */}
      <mesh position={[0, -ROOM_H / 2 + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM_W - 1, ROOM_D - 1]} />
        <meshBasicMaterial color={detColor} transparent opacity={state === 'safe' ? 0.07 : 0.28} toneMapped={false} depthWrite={false} />
      </mesh>
      {/* ceiling detector */}
      <mesh position={[0, ROOM_H / 2 - 0.4, 0]}>
        <sphereGeometry args={[0.55, 8, 6]} />
        <meshBasicMaterial ref={detRef} color={detColor} transparent toneMapped={false} />
      </mesh>
    </group>
  );
});

const Stairwell = memo(function Stairwell({ id, f, side, hl, onHover, onSelect }: { id: string; f: number; side: 'W' | 'E'; hl: boolean } & HoverApi) {
  const x = STAIR_X[side];
  return (
    <group position={[x, y0(f) + 1 + STOREY / 2 - 0.5, ROOM_Z]}>
      <mesh onPointerOver={(e) => { e.stopPropagation(); onHover(id); }} onPointerOut={() => onHover(null)} onClick={(e) => { e.stopPropagation(); onSelect(id); }}>
        <boxGeometry args={[12, STOREY - 1, 12]} />
        <meshStandardMaterial color={GREEN} emissive={GREEN} emissiveIntensity={hl ? 0.8 : 0.18} transparent opacity={hl ? 0.4 : 0.16} depthWrite={false} />
        <Edges threshold={20} color={hl ? '#ffffff' : GREEN} />
      </mesh>
      <mesh rotation={[Math.atan2(STOREY - 2, 11), 0, 0]} position={[0, 0, 0]}>
        <boxGeometry args={[9, 0.4, 12]} />
        <meshStandardMaterial color="#10b981" emissive={GREEN} emissiveIntensity={0.3} metalness={0.5} roughness={0.4} />
      </mesh>
    </group>
  );
});

function Slabs({ hlFloor, onHover, onSelect }: { hlFloor: number | null } & HoverApi) {
  return (
    <>
      {[...FLOORS, 5].map((f) => (
        <mesh key={f} position={[-2, y0(f) + 0.5, ROOM_Z]} castShadow receiveShadow
          onPointerOver={(e) => { e.stopPropagation(); if (f <= 4) onHover(`floor-${f}`); }} onPointerOut={() => onHover(null)} onClick={(e) => { e.stopPropagation(); if (f <= 4) onSelect(`floor-${f}`); }}>
          <boxGeometry args={[112, 1, 30]} />
          <meshStandardMaterial color="#0b1424" metalness={0.4} roughness={0.55} emissive={CYAN} emissiveIntensity={hlFloor === f ? 0.5 : 0.04} />
        </mesh>
      ))}
      {/* neon edge trims */}
      {[...FLOORS, 5].map((f) => (
        <mesh key={`t${f}`} position={[-2, y0(f) + 1.05, ROOM_Z + 14.9]}>
          <boxGeometry args={[112, 0.12, 0.2]} />
          <meshBasicMaterial color={CYAN} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

/** Columns + window mullions as two InstancedMeshes. */
function Facade() {
  const col = useRef<THREE.InstancedMesh>(null);
  const mul = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const d = new THREE.Object3D();
    let n = 0;
    for (const x of [-41, -19, 3, 25]) for (const z of [0.4, -20.4]) {
      d.position.set(x, (STOREY * 4) / 2 + 0.5, z); d.scale.set(1, 1, 1); d.updateMatrix(); col.current?.setMatrixAt(n++, d.matrix);
    }
    n = 0;
    for (const f of FLOORS) for (let i = 0; i < 3; i++) for (const z of [0.2, -20.2]) for (let k = 0; k < 5; k++) {
      d.position.set(ROOM_X[i] - ROOM_W / 2 + (k + 0.5) * (ROOM_W / 5), y0(f) + 1 + ROOM_H / 2, z); d.updateMatrix(); mul.current?.setMatrixAt(n++, d.matrix);
    }
    if (col.current) col.current.instanceMatrix.needsUpdate = true;
    if (mul.current) mul.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <>
      <instancedMesh ref={col} args={[undefined, undefined, 8]} castShadow frustumCulled={false}>
        <boxGeometry args={[0.9, STOREY * 4, 0.9]} />
        <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.35} />
      </instancedMesh>
      <instancedMesh ref={mul} args={[undefined, undefined, 120]} frustumCulled={false}>
        <boxGeometry args={[0.18, ROOM_H, 0.18]} />
        <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
      </instancedMesh>
    </>
  );
}

function Roof() {
  const beacon = useRef<THREE.Mesh>(null);
  useFrame((s) => { if (beacon.current) beacon.current.visible = Math.floor(s.clock.elapsedTime * 1.2) % 2 === 0; });
  const top = y0(5) + 1;
  return (
    <group>
      {[-20, 20].map((x) => (
        <mesh key={x} position={[x, top + 3, ROOM_Z]} rotation={[-Math.PI / 6, 0, 0]} castShadow>
          <boxGeometry args={[18, 0.4, 8]} />
          <meshStandardMaterial color="#06223a" metalness={1} roughness={0.15} emissive={CYAN} emissiveIntensity={0.12} />
        </mesh>
      ))}
      <mesh position={[42, top + 2, ROOM_Z - 6]} castShadow><boxGeometry args={[10, 4, 8]} /><meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.5} /></mesh>
      <mesh position={[-44, top + 7, ROOM_Z]}><cylinderGeometry args={[0.2, 0.3, 14, 6]} /><meshStandardMaterial color="#94a3b8" /></mesh>
      <mesh ref={beacon} position={[-44, top + 14.5, ROOM_Z]}><sphereGeometry args={[0.7, 8, 6]} /><meshBasicMaterial color={RED} toneMapped={false} /></mesh>
    </group>
  );
}

/* ───────────────────────── city context ───────────────────────── */

function useWindowTexture() {
  const tex = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d'); if (!g) return null;
    g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
    const r = mulberry(5);
    for (let y = 4; y < 128; y += 10) for (let x = 4; x < 64; x += 10) {
      if (r() > 0.45) { g.fillStyle = r() > 0.8 ? '#0dccf2' : '#ffd9a0'; g.globalAlpha = 0.5 + r() * 0.5; g.fillRect(x, y, 5, 6); }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  }, []);
  useEffect(() => () => tex?.dispose(), [tex]);
  return tex;
}

const CityBlock = memo(function CityBlock({ pos, size, map }: { pos: [number, number, number]; size: [number, number, number]; map: THREE.Texture | null }) {
  const tex = useMemo(() => { if (!map) return null; const t = map.clone(); t.repeat.set(Math.max(1, size[0] / 14), Math.max(1, size[1] / 22)); t.needsUpdate = true; return t; }, [map, size]);
  useEffect(() => () => tex?.dispose(), [tex]);
  return (
    <mesh position={[pos[0], size[1] / 2, pos[2]]} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#111c30" metalness={0.5} roughness={0.5} emissive="#ffffff" emissiveMap={tex ?? undefined} emissiveIntensity={tex ? 0.7 : 0} />
    </mesh>
  );
});

function Trees({ count }: { count: number }) {
  const cones = useRef<THREE.InstancedMesh>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const r = mulberry(21), d = new THREE.Object3D();
    for (let k = 0; k < count; k++) {
      const x = (r() - 0.5) * 190, z = -150 + (r() - 0.5) * 140, s = 0.8 + r() * 0.8;
      d.position.set(x, 4.5 * s, z); d.scale.setScalar(s); d.updateMatrix(); cones.current?.setMatrixAt(k, d.matrix);
      d.position.set(x, 1 * s, z); d.updateMatrix(); trunks.current?.setMatrixAt(k, d.matrix);
    }
    if (cones.current) cones.current.instanceMatrix.needsUpdate = true;
    if (trunks.current) trunks.current.instanceMatrix.needsUpdate = true;
  }, [count]);
  return (
    <>
      <instancedMesh ref={cones} args={[undefined, undefined, count]} castShadow frustumCulled={false}><coneGeometry args={[3, 8, 6]} /><meshStandardMaterial color="#14532d" roughness={0.9} /></instancedMesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, count]} frustumCulled={false}><cylinderGeometry args={[0.4, 0.5, 2, 5]} /><meshStandardMaterial color="#3b2a1a" /></instancedMesh>
    </>
  );
}

function Landmark({ lm, hl, onHover, onSelect }: { lm: typeof LANDMARKS[number]; hl: boolean } & HoverApi) {
  return (
    <group position={[lm.pos[0], 0, lm.pos[2]]}>
      <mesh position={[0, 5, 0]} onPointerOver={(e) => { e.stopPropagation(); onHover(lm.id); }} onPointerOut={() => onHover(null)} onClick={(e) => { e.stopPropagation(); onSelect(lm.id); }}>
        <coneGeometry args={[4, 10, 4]} />
        <meshStandardMaterial color={lm.color} emissive={lm.color} emissiveIntensity={hl ? 3 : 1.6} transparent opacity={0.7} />
      </mesh>
      <Html position={[0, 14, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap text-[9px] font-bold tracking-widest px-1.5 py-0.5 bg-black/70 border" style={{ color: lm.color, borderColor: lm.color + '66' }}>{lm.name}</div>
      </Html>
    </group>
  );
}

function Sensor({ id, pos, color, hl, onHover, onSelect }: { id: string; pos: [number, number, number]; color: string; hl: boolean } & HoverApi) {
  return (
    <group position={pos}>
      <mesh onPointerOver={(e) => { e.stopPropagation(); onHover(id); }} onPointerOut={() => onHover(null)} onClick={(e) => { e.stopPropagation(); onSelect(id); }}>
        <sphereGeometry args={[hl ? 2.2 : 1.6, 10, 8]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[0, -pos[1] / 2, 0]}><cylinderGeometry args={[0.08, 0.08, pos[1], 4]} /><meshBasicMaterial color={color} transparent opacity={0.35} /></mesh>
    </group>
  );
}

function AssemblyPoint({ id, label, pos, color, hl, onHover, onSelect }: { id: string; label: string; pos: [number, number, number]; color: string; hl: boolean } & HoverApi) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame((s) => { if (ring.current) { const k = 1 + ((s.clock.elapsedTime * 0.6) % 1) * 0.5; ring.current.scale.set(k, k, 1); (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1.5 - k) * 2; } });
  return (
    <group position={pos}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]} onPointerOver={(e) => { e.stopPropagation(); onHover(id); }} onPointerOut={() => onHover(null)} onClick={(e) => { e.stopPropagation(); onSelect(id); }}>
        <circleGeometry args={[hl ? 9 : 8, 40]} /><meshBasicMaterial color={color} transparent opacity={0.22} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, 0]}><ringGeometry args={[7.4, 8, 48]} /><meshBasicMaterial color={color} transparent toneMapped={false} depthWrite={false} /></mesh>
      <mesh position={[0, 8, 0]}><cylinderGeometry args={[0.15, 0.15, 16, 6]} /><meshBasicMaterial color={color} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
      <Html position={[0, 18, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap text-[9px] font-bold tracking-widest px-1.5 py-0.5 bg-black/70 border" style={{ color, borderColor: color + '66' }}>{label}</div>
      </Html>
    </group>
  );
}

function DangerPerimeter({ active }: { active: boolean }) {
  const m = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((s) => { if (m.current) m.current.opacity = active ? 0.12 + Math.sin(s.clock.elapsedTime * 3) * 0.05 : 0; });
  if (!active) return null;
  return (
    <group position={[-2, 0.08, ROOM_Z]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh><circleGeometry args={[110, 64]} /><meshBasicMaterial ref={m} color={RED} transparent toneMapped={false} depthWrite={false} /></mesh>
      <mesh><ringGeometry args={[108, 110, 96]} /><meshBasicMaterial color={RED} transparent opacity={0.8} toneMapped={false} depthWrite={false} /></mesh>
    </group>
  );
}

/** Live spread forecast tiles (backend metres -> scene; ignition (0,20) lands on Room 302). */
function SpreadTiles({ cells }: { cells: SpreadCellLite[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = Math.min(cells.length, 600);
  useLayoutEffect(() => {
    const m = ref.current; if (!m) return;
    const d = new THREE.Object3D(), c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const s = cells[k];
      d.position.set(s.x - 8, 0.2 + s.intensity * 0.4, s.y - 30); d.rotation.set(-Math.PI / 2, 0, 0); d.updateMatrix(); m.setMatrixAt(k, d.matrix);
      c.setHSL(0.14 * (1 - Math.min(1, s.intensity)), 1, 0.3 + 0.25 * s.intensity); m.setColorAt(k, c);
    }
    m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [cells, n]);
  if (!n) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 600]} frustumCulled={false}>
      <planeGeometry args={[4.8, 4.8]} />
      <meshBasicMaterial transparent opacity={0.55} toneMapped={false} depthWrite={false} />
    </instancedMesh>
  );
}

/* ───────────────────────── info model ───────────────────────── */

interface Info { title: string; sub: string; rows: [string, string][]; action?: 'ignite' | 'clear'; roomId?: string }

const STATE_LABEL: Record<RState, string> = { safe: 'CLEAR', smoke: 'SMOKE', fire: 'FIRE' };

/* ───────────────────────── overlay (legend + info) ───────────────────────── */

const LEGEND: { c: string; t: string; d: string; shape?: 'dot' | 'line' }[] = [
  { c: CYAN, t: 'Clear room', d: 'Room volume, no smoke/fire' },
  { c: ORANGE, t: 'Smoke', d: 'Smoke reached this room' },
  { c: RED, t: 'Fire', d: 'Active fire + flames' },
  { c: GREEN, t: 'Exit stairwell', d: 'Green shaft = escape stairs' },
  { c: CYAN, t: 'Route A (west)', d: 'Animated path to South lot', shape: 'line' },
  { c: GREEN, t: 'Route B (east)', d: 'Animated path to North lot', shape: 'line' },
  { c: ORANGE, t: 'Responder route', d: 'Fire dept approach', shape: 'line' },
  { c: '#ffffff', t: 'Evacuee dot', d: 'Simulated person, coloured by route', shape: 'dot' },
  { c: GREEN, t: 'Ceiling dot', d: 'Detector: green ok, orange smoke, red alarm', shape: 'dot' },
];

function Overlay({ info, wide, status, hasSpread, wind, onAction, onClose, pinned }: {
  info: Info | null; wide: boolean; status: string; hasSpread: boolean; wind: string | null; onAction: (a: 'ignite' | 'clear', id: string) => void; onClose: () => void; pinned: boolean;
}) {
  const [open, setOpen] = useState(wide);
  const stop = { onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(), onWheel: (e: React.SyntheticEvent) => e.stopPropagation() };
  return (
    <div className="absolute inset-0 pointer-events-none font-mono text-[10px] text-slate-200 select-none">
      <button className="pointer-events-auto absolute top-2 right-2 px-2 py-1 bg-black/80 border border-[#0dccf2]/40 text-[#0dccf2] font-bold tracking-widest" aria-expanded={open} onClick={() => setOpen(o => !o)} {...stop}>
        {open ? 'HIDE GUIDE' : 'HOW TO READ'}
      </button>
      {open && (
        <div className="pointer-events-auto absolute top-10 right-2 w-[230px] max-w-[70%] max-h-[70%] overflow-y-auto bg-black/85 border border-white/10 p-2.5 space-y-1.5" {...stop}>
          <p className="text-[#0dccf2] font-black tracking-widest">HOW TO READ THIS TWIN</p>
          <p className="text-slate-400 leading-snug">Engineering Block, floors F1 (bottom) to F4 (top), 3 rooms + 2 stairwells per floor. Hover or tap anything for detail. Fire, smoke and evacuees are an <b className="text-slate-200">illustrative simulation</b>{hasSpread ? '; ground tiles are live spread forecast' : ''}.</p>
          <div className="space-y-1 pt-1">
            {LEGEND.map((l) => (
              <div key={l.t} className="flex items-start gap-2">
                <span className="mt-[3px] shrink-0" style={l.shape === 'line' ? { width: 14, height: 0, borderTop: `2px dashed ${l.c}` } : { width: 9, height: 9, background: l.shape === 'dot' ? l.c : l.c + '44', border: `1px solid ${l.c}`, borderRadius: l.shape === 'dot' ? 9 : 0 }} />
                <span><b style={{ color: l.c === '#ffffff' ? '#e2e8f0' : l.c }}>{l.t}</b> <span className="text-slate-400">{l.d}</span></span>
              </div>
            ))}
            {hasSpread && <div className="flex gap-2"><span className="mt-[3px] w-[9px] h-[9px] shrink-0 bg-[#ffb300]" /><span><b className="text-[#ffb300]">Spread tiles</b> <span className="text-slate-400">yellow to red = rising fire intensity</span></span></div>}
            <div className="flex gap-2"><span className="mt-[3px] w-[9px] h-[9px] shrink-0 border border-[#ff003c] rounded-full" /><span><b className="text-[#ff003c]">Danger ring</b> <span className="text-slate-400">approx. hazard perimeter</span></span></div>
          </div>
          <p className="text-slate-500 pt-1">Drag orbit · scroll zoom · right-drag pan · grid cell ≈ 10 m</p>
        </div>
      )}
      <div className="absolute left-2 bottom-2 w-[250px] max-w-[62%] pointer-events-none">
        {info ? (
          <div className="pointer-events-auto bg-black/85 border border-[#0dccf2]/30 p-2.5 space-y-1" {...stop}>
            <div className="flex justify-between gap-2"><p className="text-white font-black tracking-wider">{info.title}</p>{pinned && <button className="text-slate-400 hover:text-white" onClick={onClose} aria-label="Close">x</button>}</div>
            <p className="text-slate-400">{info.sub}</p>
            {info.rows.map(([k, v]) => <p key={k} className="flex justify-between gap-2"><span className="text-slate-500">{k}</span><span className="text-slate-100 text-right">{v}</span></p>)}
            {info.action && info.roomId && (
              <button className="w-full mt-1 py-1 font-bold tracking-widest border" style={info.action === 'ignite' ? { color: RED, borderColor: RED + '88' } : { color: GREEN, borderColor: GREEN + '88' }} onClick={() => onAction(info.action!, info.roomId!)}>
                {info.action === 'ignite' ? 'SIMULATE FIRE HERE' : 'CLEAR FIRE'}
              </button>
            )}
          </div>
        ) : (
          <div className="bg-black/60 border border-white/10 px-2 py-1 text-slate-400">{status}{wind ? ` · ${wind}` : ''} · hover a room, stairwell or marker</div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── main scene ───────────────────────── */

export function MRUBuilding3D({ onIncidentTriggered, isCritical, scenario, spreadHeatmap, wind, showOverlay = true }: MRUBuilding3DProps = {}) {
  const low = useMemo(isLowPower, []);
  const { scene, size } = useThree();
  const [ignited, setIgnited] = useState<ReadonlySet<string>>(new Set());
  const [hov, setHov] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const t0 = useRef(0);
  const mapTex = useSafeTexture('/textures/map_texture.png', 2);
  const winTex = useWindowTexture();

  // scene atmosphere (restored on unmount)
  useEffect(() => {
    const prevBg = scene.background, prevFog = scene.fog;
    scene.background = new THREE.Color('#020617');
    scene.fog = new THREE.Fog('#020617', 260, 1100);
    return () => { scene.background = prevBg; scene.fog = prevFog; };
  }, [scene]);
  useEffect(() => { document.body.style.cursor = hov ? 'pointer' : ''; return () => { document.body.style.cursor = ''; }; }, [hov]);

  // scenario -> ignition
  useEffect(() => {
    if (scenario === 'TEST_CASE_3') setIgnited(new Set(['room-302']));
    else if (!scenario) setIgnited(new Set());
  }, [scenario]);

  // fire clock (1 Hz re-evaluation of the smoke model)
  const hasFire = ignited.size > 0;
  useEffect(() => {
    if (!hasFire) return;
    t0.current = Date.now(); setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasFire]);
  const elapsed = hasFire ? Math.max(0, (now - t0.current) / 1000) : 0;
  const level = Math.min(1, 0.4 + elapsed / 45);

  const fires = useMemo(() => Array.from(ignited).map(parseRid), [ignited]);
  const stateOf = useCallback((f: number, i: number): RState => {
    if (ignited.has(rid(f, i))) return 'fire';
    for (const g of fires) {
      const delay = Math.abs(i - g.i) * 6 + (f > g.f ? (f - g.f) * 8 : f < g.f ? (g.f - f) * 40 : 0);
      if (elapsed >= delay) return 'smoke';
    }
    return 'safe';
  }, [ignited, fires, elapsed]);

  const handleHover = useCallback((id: string | null) => setHov(id), []);
  const handleSelect = useCallback((id: string) => setSel(p => (p === id ? null : id)), []);
  const ignite = useCallback((id: string) => { setIgnited(p => new Set(p).add(id)); onIncidentTriggered?.(); }, [onIncidentTriggered]);
  const clear = useCallback((id: string) => setIgnited(p => { const n = new Set(p); n.delete(id); return n; }), []);

  const evac = hasFire || !!isCritical;
  const agents = useMemo(() => (hasFire ? buildAgents() : []), [hasFire]);
  const windV = useMemo<[number, number]>(() => {
    if (!wind) return [0.15, 0.05];
    const r = ((wind.direction_deg + 180) % 360) * Math.PI / 180;
    const k = Math.min(2, wind.speed_mps / 10);
    return [Math.sin(r) * k, -Math.cos(r) * k];
  }, [wind]);
  const windText = wind ? `wind ${wind.direction_deg}° ${wind.speed_mps} m/s` : null;

  // info for hovered (preferred) or pinned selection
  const focus = hov ?? sel;
  const info = useMemo<Info | null>(() => {
    if (!focus) return null;
    const [kind] = focus.split('-');
    if (kind === 'room') {
      const { f, i } = parseRid(focus); const s = stateOf(f, i); const occ = occupancyOf(f, i, scenario);
      const near = i === 0 ? 'West stairs' : i === 2 ? 'East stairs' : 'West or East stairs';
      const eta = s === 'fire' ? `burning ${Math.round(elapsed)} s` : s === 'smoke' ? 'smoke present' : hasFire ? 'smoke not yet here' : 'no incident';
      return { title: `ROOM ${f}0${i + 1}`, sub: `Floor ${f} · Engineering Block`, rows: [['Status', `${STATE_LABEL[s]} (${eta})`], ['Occupancy (sim.)', `${occ}%${occ > 80 ? ' OVERCROWDED' : ''}`], ['Nearest exit', near], ['Detector', s === 'fire' ? 'ALARM' : s === 'smoke' ? 'SMOKE' : 'OK']], action: s === 'fire' ? 'clear' : 'ignite', roomId: focus };
    }
    if (kind === 'stairs') { const [, side, f] = focus.split('-'); return { title: `${side === 'W' ? 'WEST' : 'EAST'} STAIRWELL · F${f}`, sub: 'Escape stairs (exit)', rows: [['Leads to', side === 'W' ? 'Route A > South assembly lot' : 'Route B > North assembly lot']] }; }
    if (kind === 'floor') {
      const f = +focus.split('-')[1]; const ss = [0, 1, 2].map(i => stateOf(f, i));
      return { title: `FLOOR ${f}`, sub: `Level ${f} of 4 · slab at ${y0(f)} m`, rows: [['Rooms', `${ss.filter(s => s === 'fire').length} fire · ${ss.filter(s => s === 'smoke').length} smoke · ${ss.filter(s => s === 'safe').length} clear`], ['Exits', '2 stairwells (W, E)']] };
    }
    if (focus === 'asm-A') return { title: 'ASSEMBLY A', sub: 'South lot (muster point)', rows: [['Reached via', 'West stairs, Route A']] };
    if (focus === 'asm-B') return { title: 'ASSEMBLY B', sub: 'North lot (muster point)', rows: [['Reached via', 'East stairs, Route B']] };
    if (kind === 'lm') { const lm = LANDMARKS.find(l => l.id === focus); return lm ? { title: lm.name, sub: 'Campus landmark', rows: [['Role', lm.text]] } : null; }
    if (kind === 'aqi') { const v = focus === 'aqi-1' ? (scenario === 'TRANSIT_JAM' ? 142 : 42) : 35; return { title: `AQI SENSOR ${focus.slice(-1)}`, sub: 'Air quality (simulated feed)', rows: [['AQI', `${v} ${v > 100 ? 'UNHEALTHY' : 'GOOD'}`]] }; }
    return null;
  }, [focus, stateOf, scenario, elapsed, hasFire]);

  const status = hasFire ? `FIRE ACTIVE · ${fires.length} room${fires.length > 1 ? 's' : ''}` : 'ALL CLEAR';
  const hlFloor = focus?.startsWith('floor-') ? +focus.split('-')[1] : null;
  const fireP = useMemo(() => fires.map(g => [ROOM_X[g.i], y0(g.f) + 1, ROOM_Z] as [number, number, number]), [fires]);
  const lightRef = useRef<THREE.PointLight>(null);
  useFrame((s) => {
    const l = lightRef.current; if (!l) return;
    const p = fireP[0];
    if (p) { l.position.set(p[0], p[1] + 6, p[2] + 6); l.intensity = (300 + Math.sin(s.clock.elapsedTime * 13) * 90) * level; } else l.intensity = 0;
  });

  return (
    <group>
      {/* lighting */}
      <hemisphereLight args={['#8fb8ff', '#0a1020', 0.55]} />
      <directionalLight position={[140, 200, 120]} intensity={1.5} color="#dbe8ff" castShadow shadow-mapSize={low ? [1024, 1024] : [2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.4}
        shadow-camera-left={-120} shadow-camera-right={120} shadow-camera-top={120} shadow-camera-bottom={-120} shadow-camera-near={10} shadow-camera-far={600} />
      <directionalLight position={[-120, 80, -150]} intensity={0.45} color={CYAN} />
      <pointLight ref={lightRef} color="#ff6a1a" intensity={0} distance={120} decay={1.6} />
      <SafeBoundary>
        <Environment resolution={128} frames={1} environmentIntensity={0.6}>
          <Lightformer form="rect" intensity={2} color="#cfe3ff" position={[0, 8, -9]} scale={[14, 4, 1]} />
          <Lightformer form="rect" intensity={1.4} color={CYAN} position={[-9, 3, 4]} rotation={[0, Math.PI / 2, 0]} scale={[10, 3, 1]} />
          <Lightformer form="rect" intensity={1} color="#ffb070" position={[9, 2, 5]} rotation={[0, -Math.PI / 2, 0]} scale={[8, 3, 1]} />
        </Environment>
      </SafeBoundary>
      {!low && <Stars radius={900} depth={60} count={1200} factor={5} fade speed={0.4} />}

      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[900, 64]} />
        <meshStandardMaterial map={mapTex ?? undefined} color={mapTex ? '#5d7f96' : '#08111f'} emissive={CYAN} emissiveMap={mapTex ?? undefined} emissiveIntensity={mapTex ? 0.35 : 0.02} roughness={0.9} metalness={0.1} />
      </mesh>
      <Grid position={[0, 0.06, 0]} args={[10, 10]} infiniteGrid cellSize={10} sectionSize={50} cellThickness={0.4} sectionThickness={0.9} cellColor="#0b4a5e" sectionColor="#0dccf2" fadeDistance={420} fadeStrength={1.6} />

      {/* city context */}
      <mesh position={[0, 0.1, 100]} receiveShadow><boxGeometry args={[1000, 0.2, 60]} /><meshStandardMaterial color="#0b1220" roughness={0.8} /></mesh>
      <mesh position={[-150, 0.1, 200]} receiveShadow><boxGeometry args={[60, 0.2, 1000]} /><meshStandardMaterial color="#0b1220" roughness={0.8} /></mesh>
      <mesh position={[0, 0.25, 100]}><boxGeometry args={[1000, 0.05, 0.6]} /><meshBasicMaterial color="#334155" /></mesh>
      {([[300, 100, 250, 120, 120], [250, 80, -200, 150, 150], [-300, 60, -300, 200, 200], [-350, 90, 0, 80, 80], [0, 30, -400, 400, 100], [450, 40, 0, 100, 100]] as const).map(([x, h, z, w, d]) => (
        <CityBlock key={`${x}_${z}`} pos={[x, 0, z]} size={[w, h, d]} map={winTex} />
      ))}
      <mesh position={[0, 0.1, -150]} receiveShadow><boxGeometry args={[200, 0.2, 150]} /><meshStandardMaterial color="#064e3b" roughness={1} /></mesh>
      <Trees count={low ? 24 : 55} />
      {LANDMARKS.map((lm) => <Landmark key={lm.id} lm={lm} hl={focus === lm.id} onHover={handleHover} onSelect={handleSelect} />)}
      <Sensor id="aqi-1" pos={[-100, 20, 50]} color={scenario === 'TRANSIT_JAM' ? RED : GREEN} hl={focus === 'aqi-1'} onHover={handleHover} onSelect={handleSelect} />
      <Sensor id="aqi-2" pos={[100, 20, -150]} color={GREEN} hl={focus === 'aqi-2'} onHover={handleHover} onSelect={handleSelect} />

      {/* building */}
      <Slabs hlFloor={hlFloor} onHover={handleHover} onSelect={handleSelect} />
      <Facade />
      <Roof />
      {FLOORS.map((f) => (
        <React.Fragment key={f}>
          {[0, 1, 2].map((i) => {
            const id = rid(f, i);
            return <Room key={id} id={id} f={f} i={i} state={stateOf(f, i)} hl={focus === id} crowded={occupancyOf(f, i, scenario) > 80} onHover={handleHover} onSelect={handleSelect} />;
          })}
          <Stairwell id={`stairs-W-${f}`} f={f} side="W" hl={focus === `stairs-W-${f}`} onHover={handleHover} onSelect={handleSelect} />
          <Stairwell id={`stairs-E-${f}`} f={f} side="E" hl={focus === `stairs-E-${f}`} onHover={handleHover} onSelect={handleSelect} />
          <Html position={[-66, y0(f) + 6, ROOM_Z]} center zIndexRange={[10, 0]}>
            <button onClick={() => handleSelect(`floor-${f}`)} onPointerEnter={() => handleHover(`floor-${f}`)} onPointerLeave={() => handleHover(null)}
              className="px-1.5 py-0.5 text-[10px] font-black tracking-widest bg-black/70 border border-[#0dccf2]/40 text-[#0dccf2]">F{f}</button>
          </Html>
        </React.Fragment>
      ))}
      <Html position={[-2, y0(5) + 22, ROOM_Z]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap text-[10px] font-black tracking-[0.25em] text-[#0dccf2] bg-black/60 px-2 py-0.5 border border-[#0dccf2]/30">ENGINEERING BLOCK</div>
      </Html>
      <Html position={[STAIR_X.W, 8, 6]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}><div className="text-[9px] font-black bg-[#00ffaa] text-black px-1">EXIT A</div></Html>
      <Html position={[STAIR_X.E, 8, -26]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}><div className="text-[9px] font-black bg-[#00ffaa] text-black px-1">EXIT B</div></Html>

      {/* routes, assembly, responders */}
      <GlowRoute points={PA} color={CYAN} active={evac} />
      <GlowRoute points={PB} color={GREEN} active={evac} />
      {evac && <GlowRoute points={PR} color={ORANGE} active flip />}
      <AssemblyPoint id="asm-A" label="ASSEMBLY A · SOUTH LOT" pos={[-90, 0, 42]} color={CYAN} hl={focus === 'asm-A'} onHover={handleHover} onSelect={handleSelect} />
      <AssemblyPoint id="asm-B" label="ASSEMBLY B · NORTH LOT" pos={[90, 0, -60]} color={GREEN} hl={focus === 'asm-B'} onHover={handleHover} onSelect={handleSelect} />
      {agents.length > 0 && <Evacuees agents={agents} />}

      {/* fire + hazard */}
      {fireP.map((p, k) => <FireEffect key={fires[k].f * 10 + fires[k].i} position={p} level={level} wind={windV} low={low} />)}
      {fires.length > 0 && (
        <Html position={[fireP[0][0], y0(fires[0].f) + 28, ROOM_Z]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap text-[9px] font-black tracking-widest bg-[#ff003c] text-white px-1.5 py-0.5 animate-pulse">FIRE · {rid(fires[0].f, fires[0].i).slice(5)} · F{fires[0].f}</div>
        </Html>
      )}
      <DangerPerimeter active={hasFire || !!isCritical} />
      {spreadHeatmap && spreadHeatmap.length > 0 && <SpreadTiles cells={spreadHeatmap} />}

      {showOverlay && (
        <Html calculatePosition={(_o, _c, s) => [s.width / 2, s.height / 2]} fullscreen zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
          <Overlay info={info} wide={size.width >= 640} status={status} hasSpread={!!spreadHeatmap?.length} wind={windText} pinned={!!sel && !hov}
            onAction={(a, id) => (a === 'ignite' ? ignite(id) : clear(id))} onClose={() => setSel(null)} />
        </Html>
      )}
    </group>
  );
}

/* ───────────────────────── drop-in full canvas (optional) ───────────────────────── */

class CanvasBoundary extends React.Component<{ children: React.ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() {
    return this.state.err
      ? <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-400 bg-[#020617]">3D twin unavailable (WebGL not supported or failed to start).</div>
      : this.props.children;
  }
}

/** Self-contained twin: Canvas + controls + lifecycle (paused off-screen, dpr capped, context-loss safe). */
export function MRUTwin(props: MRUBuilding3DProps & { className?: string }) {
  const { className, ...rest } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [dpr, setDpr] = useState(isLowPower() ? 1.25 : 1.75);
  const [lost, setLost] = useState(false);
  const controls = useRef<any>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);

  useEffect(() => {
    const el = wrap.current; if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div ref={wrap} className={className} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <CanvasBoundary>
        <Canvas shadows dpr={[1, dpr]} frameloop={visible ? 'always' : 'never'} camera={{ position: [140, 85, 170], fov: 45, near: 1, far: 2500 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            const c = gl.domElement;
            c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setLost(true); });
            c.addEventListener('webglcontextrestored', () => setLost(false));
          }}>
          <PerformanceMonitor onDecline={() => setDpr(1)} />
          <MRUBuilding3D {...rest} />
          <OrbitControls ref={controls} target={[0, 22, -10]} enableDamping minDistance={50} maxDistance={650} maxPolarAngle={Math.PI / 2.05}
            autoRotate={!reduced} autoRotateSpeed={0.35}
            onStart={() => { clearTimeout(timer.current); if (controls.current) controls.current.autoRotate = false; }}
            onEnd={() => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (controls.current && !reduced) controls.current.autoRotate = true; }, 6000); }} />
        </Canvas>
      </CanvasBoundary>
      {lost && <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-[11px] text-slate-300">Graphics context lost, restoring...</div>}
    </div>
  );
}
