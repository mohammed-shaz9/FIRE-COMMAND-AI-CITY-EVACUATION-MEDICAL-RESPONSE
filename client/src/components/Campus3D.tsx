import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import { FireEffect, GlowRoute } from './visualization/MRUBuilding3D';

interface Building {
  name: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  color: string;
}

interface Incident {
  id: number;
  locationX: number;
  locationY: number;
  locationZ: number;
  type: string;
  severity: string;
}

interface EvacuationRoute {
  path: Array<{ x: number; y: number }>;
  severity?: string;
}

type Zone = { x: number; y: number; severity: string };

// MRUH campus buildings; x/z are scene metres on the same synthetic hill used by pathfinding.ts
const CAMPUS_BUILDINGS: Building[] = [
  { name: 'Engineering Block', x: -50, y: 0, z: -50, width: 60, height: 40, depth: 50, color: '#4a5568' },
  { name: 'Science Block', x: 200, y: 0, z: 200, width: 50, height: 35, depth: 45, color: '#2d3748' },
  { name: 'Library', x: 50, y: 0, z: 80, width: 40, height: 30, depth: 40, color: '#334155' },
  { name: 'Hostel A', x: -80, y: 0, z: 50, width: 45, height: 25, depth: 40, color: '#4a5568' },
  { name: 'Medical Center', x: 120, y: 0, z: 80, width: 35, height: 20, depth: 35, color: '#9b2c2c' },
  { name: 'Admin Block', x: 0, y: 0, z: -80, width: 50, height: 25, depth: 40, color: '#52525b' },
];

const SPAN = 500; // terrain is 500 x 500 m centred on the origin (matches pathfinding grid +-250)
const CELLS = 25;
// Same slope as pathfinding.ts: 0 m at (-250,-250) rising to 40 m at (+250,+250)
const elevAt = (x: number, z: number) => (THREE.MathUtils.clamp((x + 250) / SPAN, 0, 1) + THREE.MathUtils.clamp((z + 250) / SPAN, 0, 1)) * 20;

const SEV: Record<string, string> = { critical: '#ff0000', warning: '#ff9900' };
const sevColor = (s: string) => SEV[s] ?? '#00ff88';
const ROUTE_COLORS = ['#ff003c', '#0dccf2', '#00ffaa', '#ff9900'];

function Terrain() {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(SPAN, SPAN, CELLS, CELLS);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const lo = new THREE.Color('#1f3d2a'), hi = new THREE.Color('#5b5a3c'), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const h = elevAt(p.getX(i), p.getZ(i));
      p.setY(i, h);
      c.copy(lo).lerp(hi, h / 40); col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.95} flatShading />
    </mesh>
  );
}

const BuildingMesh = memo(function BuildingMesh({ b }: { b: Building }) {
  const [hov, setHov] = useState(false);
  const y = elevAt(b.x, b.z);
  return (
    <group position={[b.x, y + b.height / 2, b.z]}>
      <mesh castShadow receiveShadow onPointerOver={(e) => { e.stopPropagation(); setHov(true); }} onPointerOut={() => setHov(false)}>
        <boxGeometry args={[b.width, b.height, b.depth]} />
        <meshStandardMaterial color={b.color} metalness={0.3} roughness={0.55} emissive={hov ? '#0dccf2' : '#000000'} emissiveIntensity={hov ? 0.35 : 0} />
      </mesh>
      <Html position={[0, b.height / 2 + 6, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`whitespace-nowrap text-[9px] font-bold tracking-wider px-1.5 py-0.5 border bg-black/70 ${hov ? 'text-white border-[#0dccf2]' : 'text-[#0dccf2]/80 border-white/10'}`}>
          {b.name}{hov ? ` · ${b.height} m tall · ground ${Math.round(y)} m ASL (sim.)` : ''}
        </div>
      </Html>
    </group>
  );
});

function Zones({ zones }: { zones: Zone[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = Math.min(zones.length, 400);
  useLayoutEffect(() => {
    const m = ref.current; if (!m) return;
    const d = new THREE.Object3D(), c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const z = zones[k];
      d.position.set(z.x, elevAt(z.x, z.y) + 1, z.y); d.rotation.set(-Math.PI / 2, 0, 0); d.updateMatrix();
      m.setMatrixAt(k, d.matrix); m.setColorAt(k, c.set(sevColor(z.severity)));
    }
    m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [zones, n]);
  if (!n) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 400]} frustumCulled={false}>
      <planeGeometry args={[50, 50]} />
      <meshBasicMaterial transparent opacity={0.35} toneMapped={false} depthWrite={false} />
    </instancedMesh>
  );
}

function IncidentMarker({ incident }: { incident: Incident }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    const m = ref.current; if (!m) return;
    m.rotation.y = s.clock.elapsedTime * 1.2;
    m.scale.setScalar(1 + Math.sin(s.clock.elapsedTime * 4) * 0.15);
  });
  const color = sevColor(incident.severity);
  const y = elevAt(incident.locationX, incident.locationY);
  return (
    <group position={[incident.locationX, y, incident.locationY]}>
      <mesh ref={ref} position={[0, 20, 0]}>
        <icosahedronGeometry args={[7, 1]} />
        <meshBasicMaterial color={color} wireframe toneMapped={false} />
      </mesh>
      <Html position={[0, 34, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap text-[9px] font-black tracking-widest px-1.5 py-0.5 bg-black/80 border" style={{ color, borderColor: color }}>
          {incident.type.toUpperCase()} · {incident.severity.toUpperCase()}
        </div>
      </Html>
      {incident.type === 'fire' && <FireEffect position={[0, 0.5, 0]} level={incident.severity === 'critical' ? 1 : 0.6} wind={[0.3, 0.05]} low={false} />}
    </group>
  );
}

function Route({ route, index }: { route: EvacuationRoute; index: number }) {
  const pts = useMemo(() => (route.path ?? []).map(p => new THREE.Vector3(p.x, elevAt(p.x, p.y) + 4, p.y)), [route]);
  if (pts.length < 2) return null;
  return <GlowRoute points={pts} color={ROUTE_COLORS[index % ROUTE_COLORS.length]} active />;
}

function Atmosphere() {
  const { scene } = useThree();
  useEffect(() => {
    const bg = scene.background, fog = scene.fog;
    scene.background = new THREE.Color('#020617');
    scene.fog = new THREE.Fog('#020617', 500, 1400);
    return () => { scene.background = bg; scene.fog = fog; };
  }, [scene]);
  return null;
}

function Legend({ zones, incidents, routes }: { zones: number; incidents: number; routes: number }) {
  const [open, setOpen] = useState(false);
  const row = (c: string, t: string, d: string, line = false) => (
    <div className="flex gap-2 items-start">
      <span className="mt-[3px] shrink-0" style={line ? { width: 14, borderTop: `2px dashed ${c}` } : { width: 9, height: 9, background: c + '66', border: `1px solid ${c}` }} />
      <span><b style={{ color: c }}>{t}</b> <span className="text-slate-400">{d}</span></span>
    </div>
  );
  return (
    <div className="absolute top-2 right-2 z-10 font-mono text-[10px] text-slate-200 flex flex-col items-end gap-1">
      <button className="px-2 py-1 bg-black/80 border border-[#0dccf2]/40 text-[#0dccf2] font-bold tracking-widest" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'HIDE GUIDE' : 'HOW TO READ'}</button>
      {open && (
        <div className="w-[230px] max-w-[80vw] bg-black/85 border border-white/10 p-2.5 space-y-1.5">
          <p className="text-[#0dccf2] font-black tracking-widest">CAMPUS TWIN</p>
          <p className="text-slate-400 leading-snug">Terrain rises 0 to 40 m toward the north-east corner (same slope the evacuation pathfinder uses). Boxes are campus buildings; hover for height.</p>
          {row('#ff0000', 'Critical zone', 'heat tile, high severity')}
          {row('#ff9900', 'Warning zone', 'heat tile, medium')}
          {row('#00ff88', 'Safe zone', 'heat tile, low')}
          {row('#ff003c', 'Incident', 'spinning marker; flames for fire')}
          {row('#0dccf2', 'Evacuation route', 'animated dashes, one colour per route', true)}
          <p className="text-slate-500">{incidents} incident(s) · {zones} zone(s) · {routes} route(s). Drag orbit, scroll zoom.</p>
        </div>
      )}
    </div>
  );
}

class Boundary extends React.Component<{ children: React.ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() {
    return this.state.err
      ? <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-400 bg-[#020617]">3D campus unavailable (WebGL failed to start).</div>
      : this.props.children;
  }
}

function CampusScene({ incidents, evacuationRoutes, zones }: { incidents: Incident[]; evacuationRoutes: EvacuationRoute[]; zones: Zone[] }) {
  return (
    <>
      <Atmosphere />
      <hemisphereLight args={['#8fb8ff', '#0a1020', 0.7]} />
      <directionalLight position={[250, 300, 150]} intensity={1.5} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} shadow-normalBias={0.5}
        shadow-camera-left={-300} shadow-camera-right={300} shadow-camera-top={300} shadow-camera-bottom={-300} shadow-camera-near={10} shadow-camera-far={900} />
      <Terrain />
      {CAMPUS_BUILDINGS.map((b) => <BuildingMesh key={b.name} b={b} />)}
      <Zones zones={zones} />
      {incidents.map((i) => <IncidentMarker key={i.id} incident={i} />)}
      {evacuationRoutes.map((r, k) => <Route key={k} route={r} index={k} />)}
    </>
  );
}

interface Campus3DProps {
  incidents: Incident[];
  evacuationRoutes?: EvacuationRoute[];
  zones?: Zone[];
}

export function Campus3D({ incidents, evacuationRoutes = [], zones = [] }: Campus3DProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [dpr, setDpr] = useState(1.75);
  const controls = useRef<any>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const el = wrap.current; if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(timer.current); };
  }, []);

  return (
    <div ref={wrap} style={{ width: '100%', height: '100%', minHeight: '600px', position: 'relative' }}>
      <Boundary>
        <Canvas shadows dpr={[1, dpr]} frameloop={visible ? 'always' : 'never'} camera={{ position: [320, 240, 320], fov: 50, near: 1, far: 3000 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
          <PerformanceMonitor onDecline={() => setDpr(1)} />
          <CampusScene incidents={incidents} evacuationRoutes={evacuationRoutes} zones={zones} />
          <OrbitControls ref={controls} target={[0, 20, 0]} enableDamping minDistance={80} maxDistance={900} maxPolarAngle={Math.PI / 2.1} autoRotate autoRotateSpeed={0.3}
            onStart={() => { clearTimeout(timer.current); if (controls.current) controls.current.autoRotate = false; }}
            onEnd={() => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (controls.current) controls.current.autoRotate = true; }, 6000); }} />
        </Canvas>
      </Boundary>
      <Legend zones={zones.length} incidents={incidents.length} routes={evacuationRoutes.length} />
    </div>
  );
}

export default Campus3D;
