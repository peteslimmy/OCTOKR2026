"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Group } from "three";
import { SpriteLabel } from "./sprite-label";

export interface Bar3D {
  key: string; unitId: string; label: string; detail: string;
  col: number; row: number;
  segments: { value: number; color: string; name: string }[];
}

interface Props {
  bars: Bar3D[]; cols: string[]; rows: string[];
  /** Value that maps to the tallest column. */
  max: number; barSize?: number; gap?: number;
  onSelect: (unitId: string) => void;
  ariaLabel: string; reduceMotion: boolean;
}

interface Tip { x: number; y: number; label: string; detail: string }

const HEIGHT = 4;
const noopSubscribe = () => () => undefined;
function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

/** One stacked column: each segment grows up from the floor with an ease-out unless reduced motion is requested. */
function Column({ bar, x, z, size, max, reduce, hovered, onTip, onSelect }: {
  bar: Bar3D; x: number; z: number; size: number; max: number; reduce: boolean; hovered: boolean; onTip: (k: string | null, tip?: Tip) => void; onSelect: (id: string) => void;
}) {
  const refs = useRef<(Group | null)[]>([]);
  const grown = useRef(reduce ? 1 : 0);
  const parts = bar.segments.reduce<{ name: string; color: string; value: number; h: number; y: number }[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    acc.push({ ...s, h: Math.max(0, (s.value / max) * HEIGHT), y: prev ? prev.y + prev.h : 0 });
    return acc;
  }, []);
  const total = parts.reduce((a, p) => a + p.h, 0);
  useFrame((_, dt) => {
    if (grown.current >= 0.999) return;
    grown.current = Math.min(1, grown.current + dt * 1.6);
    const e = 1 - Math.pow(1 - grown.current, 3);
    refs.current.forEach((g, i) => { const p = parts[i]; if (g && p) { g.scale.y = Math.max(0.0001, e); g.position.y = p.y * e; } });
  });
  const tipFrom = (e: ThreeEvent<PointerEvent>) => ({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, label: bar.label, detail: bar.detail });
  return (
    <group position={[x, 0, z]}
      onPointerOver={(e) => { e.stopPropagation(); onTip(bar.key, tipFrom(e)); document.body.style.cursor = "pointer"; }}
      onPointerMove={(e) => { e.stopPropagation(); onTip(bar.key, tipFrom(e)); }}
      onPointerOut={() => { onTip(null); document.body.style.cursor = ""; }}
      onClick={(e) => { e.stopPropagation(); onSelect(bar.unitId); }}>
      {parts.map((p, i) => (
        <group key={p.name} ref={(g) => { refs.current[i] = g; }} position={[0, reduce ? p.y : 0, 0]} scale={[1, reduce ? 1 : 0.0001, 1]}>
          <mesh position={[0, p.h / 2, 0]} castShadow>
            <boxGeometry args={[size, Math.max(p.h, 0.0001), size]} />
            <meshStandardMaterial color={p.color} roughness={0.38} metalness={0.12} emissive={p.color} emissiveIntensity={hovered ? 0.35 : 0.04} />
          </mesh>
        </group>
      ))}
      {total === 0 ? <mesh position={[0, 0.02, 0]}><boxGeometry args={[size, 0.04, size]} /><meshStandardMaterial color="#cbd5e1" /></mesh> : null}
    </group>
  );
}

function Scene({ bars, cols, rows, max, barSize = 0.8, gap = 1.25, onSelect, reduceMotion, onTip, hover }: Props & { onTip: (k: string | null, tip?: Tip) => void; hover: string | null }) {
  const width = (cols.length - 1) * gap;
  const depth = (rows.length - 1) * gap;
  const pos = (col: number, row: number) => [col * gap - width / 2, row * gap - depth / 2] as const;
  const span = Math.max(width, depth, 4);
  return (
    <>
      <color attach="background" args={["#f8fafc"]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[6, 10, 6]} intensity={1.4} castShadow />
      <directionalLight position={[-6, 4, -4]} intensity={0.35} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[width + gap * 3, depth + gap * 3]} />
        <meshStandardMaterial color="#eef2f7" />
      </mesh>
      <gridHelper args={[Math.max(width, depth) + gap * 3, Math.round((Math.max(width, depth) + gap * 3) / gap), "#94a3b8", "#cbd5e1"]} position={[0, 0.001, 0]} />
      {bars.map((b) => { const [x, z] = pos(b.col, b.row); return <Column key={b.key} bar={b} x={x} z={z} size={barSize} max={max} reduce={reduceMotion} hovered={hover === b.key} onTip={onTip} onSelect={onSelect} />; })}
      {cols.map((c, i) => (c ? <SpriteLabel key={`c${i}`} text={c} position={[pos(i, 0)[0], 0.25, depth / 2 + gap * 1.05]} height={0.38} /> : null))}
      {rows.map((r, i) => <SpriteLabel key={`r${i}`} text={r.length > 16 ? `${r.slice(0, 15)}…` : r} position={[-width / 2 - gap * 1.25, 0.25, pos(0, i)[1]]} height={0.4} color="#1e293b" />)}
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.08} minDistance={span * 0.6} maxDistance={span * 3} target={[0, HEIGHT / 4, 0]} />
    </>
  );
}

/** An interactive 3D column chart: drag to rotate, scroll to zoom, hover for detail, click a column to open that unit. */
export default function Columns3D(props: Props) {
  const ok = useSyncExternalStore(noopSubscribe, webglAvailable, () => null);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const onTip = (k: string | null, t?: Tip) => { setHover(k); setTip(k && t ? t : null); };
  const span = useMemo(() => Math.max((props.cols.length - 1) * (props.gap ?? 1.25), (props.rows.length - 1) * (props.gap ?? 1.25), 4), [props.cols.length, props.rows.length, props.gap]);
  if (ok === null) return <div className="shimmer h-[420px] w-full rounded-xl" aria-hidden />;
  if (!ok) return <p className="rounded-xl bg-surface p-6 text-center text-sm text-muted">3D view is not available in this browser. The 2D chart shows the same figures.</p>;
  return (
    <div role="img" aria-label={props.ariaLabel} className="relative h-[420px] w-full overflow-hidden rounded-xl border border-line">
      <Canvas shadows dpr={[1, 2]} camera={{ position: [span * 1.05, span * 0.9, span * 1.35], fov: 38 }}>
        <Scene {...props} onTip={onTip} hover={hover} />
      </Canvas>
      {tip ? (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-lg border border-line bg-white/95 px-3 py-2 text-xs shadow-xl" style={{ left: tip.x, top: tip.y }}>
          <p className="font-semibold text-ink">{tip.label}</p><p className="text-muted">{tip.detail}</p>
        </div>
      ) : null}
      <p className="pointer-events-none absolute bottom-2 left-3 rounded bg-white/80 px-2 py-0.5 text-[11px] text-muted">Drag to rotate · scroll to zoom · click a column to open it</p>
    </div>
  );
}
