"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ExtrudeGeometry, Shape, type Group } from "three";

export interface Slice3D { name: string; value: number; color: string }
interface Tip { x: number; y: number; name: string; detail: string }

const noopSubscribe = () => () => undefined;
function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

/** One ring sector, extruded so it has real thickness. The hovered slice slides outwards and lifts. */
function Piece({ start, end, color, name, value, share, active, onTip, reduce }: {
  start: number; end: number; color: string; name: string; value: number; share: number; active: boolean; onTip: (n: string | null, t?: Tip) => void; reduce: boolean;
}) {
  const g = useRef<Group>(null);
  const geometry = useMemo(() => {
    const inner = 1.15, outer = 2, steps = Math.max(2, Math.ceil(((end - start) / (Math.PI * 2)) * 64));
    const s = new Shape();
    for (let i = 0; i <= steps; i++) { const a = start + ((end - start) * i) / steps; const x = Math.cos(a) * outer, y = Math.sin(a) * outer; if (i === 0) s.moveTo(x, y); else s.lineTo(x, y); }
    for (let i = steps; i >= 0; i--) { const a = start + ((end - start) * i) / steps; s.lineTo(Math.cos(a) * inner, Math.sin(a) * inner); }
    s.closePath();
    return new ExtrudeGeometry(s, { depth: 0.55, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 1 });
  }, [start, end]);
  const mid = (start + end) / 2;
  useFrame((_, dt) => {
    const o = g.current; if (!o) return;
    const k = reduce ? 1 : Math.min(1, dt * 9);
    const push = active ? 0.22 : 0, lift = active ? 0.35 : 0;
    o.position.x += (Math.cos(mid) * push - o.position.x) * k;
    o.position.y += (Math.sin(mid) * push - o.position.y) * k;
    o.position.z += (lift - o.position.z) * k;
  });
  const tipFrom = (e: ThreeEvent<PointerEvent>): Tip => ({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, name, detail: `${value.toLocaleString("en-GB")} tasks · ${share.toFixed(1)}%` });
  return (
    <group ref={g}
      onPointerOver={(e) => { e.stopPropagation(); onTip(name, tipFrom(e)); document.body.style.cursor = "pointer"; }}
      onPointerMove={(e) => { e.stopPropagation(); onTip(name, tipFrom(e)); }}
      onPointerOut={() => { onTip(null); document.body.style.cursor = ""; }}>
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.15} emissive={color} emissiveIntensity={active ? 0.3 : 0.03} />
      </mesh>
    </group>
  );
}

function Scene({ slices, reduce, hover, onTip }: { slices: Slice3D[]; reduce: boolean; hover: string | null; onTip: (n: string | null, t?: Tip) => void }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const pieces = slices.filter((s) => s.value > 0).reduce<(Slice3D & { start: number; end: number; share: number; next: number })[]>((acc, s) => {
    const start = acc.length ? acc[acc.length - 1].next : Math.PI / 2;
    const sweep = (s.value / total) * Math.PI * 2;
    acc.push({ ...s, start, end: start + sweep - 0.02, next: start + sweep, share: (s.value / total) * 100 });
    return acc;
  }, []);
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 6, 8]} intensity={1.3} castShadow />
      <directionalLight position={[-5, -3, 4]} intensity={0.3} />
      <group rotation={[-0.55, 0, 0]}>
        {pieces.map((p) => <Piece key={p.name} start={p.start} end={p.end} color={p.color} name={p.name} value={p.value} share={p.share} active={hover === p.name} onTip={onTip} reduce={reduce} />)}
      </group>
      <OrbitControls makeDefault enableDamping enablePan={false} minDistance={4} maxDistance={11} />
    </>
  );
}

export default function Donut3D({ slices, centre, ariaLabel, reduceMotion }: { slices: Slice3D[]; centre: string; ariaLabel: string; reduceMotion: boolean }) {
  const ok = useSyncExternalStore(noopSubscribe, webglAvailable, () => null);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const onTip = (n: string | null, t?: Tip) => { setHover(n); setTip(n && t ? t : null); };
  if (ok === null) return <div className="shimmer h-[300px] w-full rounded-xl" aria-hidden />;
  if (!ok) return <p className="rounded-xl bg-surface p-6 text-center text-sm text-muted">3D view is not available in this browser. The 2D chart shows the same figures.</p>;
  return (
    <div role="img" aria-label={ariaLabel} className="relative h-[300px] w-full overflow-hidden rounded-xl border border-line bg-slate-50">
      <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 0, 7.5], fov: 40 }}><Scene slices={slices} reduce={reduceMotion} hover={hover} onTip={onTip} /></Canvas>
      <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-xl font-semibold tabular-nums text-ink">{centre}<span className="block text-[11px] font-normal text-muted">completion</span></p>
      {tip ? (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-lg border border-line bg-white/95 px-3 py-1.5 text-xs shadow-xl" style={{ left: tip.x, top: tip.y }}>
          <p className="font-semibold text-ink">{tip.name}</p><p className="text-muted">{tip.detail}</p>
        </div>
      ) : null}
    </div>
  );
}
