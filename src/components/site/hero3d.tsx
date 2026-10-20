"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, useSyncExternalStore } from "react";
import type { Group } from "three";
import { DashboardArt } from "./art";

const noopSubscribe = () => () => undefined;
function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

// A fixed, made-up pattern of heights: it is decoration, not data.
const HEIGHTS = [[0.9, 1.6, 1.2, 2.2, 1.7], [1.4, 2.4, 1.9, 2.9, 2.3], [1.1, 1.8, 2.6, 3.4, 2.8], [0.8, 1.3, 2.1, 2.6, 3.7]];

function Columns({ color, still }: { color: string; still: boolean }) {
  const g = useRef<Group>(null);
  useFrame((_, dt) => { if (!still && g.current) g.current.rotation.y += dt * 0.25; });
  return (
    <group ref={g} rotation={[0, 0.7, 0]} position={[0, -1.2, 0]}>
      {HEIGHTS.flatMap((row, r) => row.map((h, c) => (
        <mesh key={`${r}-${c}`} position={[(c - 2) * 0.9, h / 2, (r - 1.5) * 0.9]}>
          <boxGeometry args={[0.62, h, 0.62]} />
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} opacity={0.55 + 0.45 * (h / 3.7)} transparent />
        </mesh>
      )))}
    </group>
  );
}

/** A slowly turning field of columns used as the landing hero picture. Decorative only; a still picture is used without WebGL or with reduced motion. */
export default function Hero3D({ color, reduceMotion }: { color: string; reduceMotion: boolean }) {
  const ok = useSyncExternalStore(noopSubscribe, webglAvailable, () => null);
  if (ok === null) return <div className="shimmer aspect-[16/11] w-full rounded-2xl" aria-hidden />;
  if (!ok) return <DashboardArt className="w-full" />;
  return (
    <div className="aspect-[16/11] w-full" aria-hidden>
      <Canvas dpr={[1, 2]} camera={{ position: [5.5, 4.2, 6.5], fov: 36 }} gl={{ alpha: true }}>
        <ambientLight intensity={1} />
        <directionalLight position={[5, 8, 5]} intensity={1.6} />
        <Columns color={color} still={reduceMotion} />
      </Canvas>
    </div>
  );
}
