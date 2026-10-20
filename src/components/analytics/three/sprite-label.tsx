"use client";

import { useEffect, useMemo } from "react";
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";

/**
 * A text label drawn into a texture and shown on a sprite that always faces the camera. It avoids the DOM-in-canvas helper, which
 * mounts a second React root per label and misbehaves under React 19.
 */
export function SpriteLabel({ text, position, color = "#334155", height = 0.42, weight = 600 }: { text: string; position: [number, number, number]; color?: string; height?: number; weight?: number }) {
  const { texture, aspect } = useMemo(() => {
    const scale = 3;
    const font = `${weight} ${22 * scale}px ui-sans-serif, system-ui, sans-serif`;
    const probe = document.createElement("canvas").getContext("2d")!;
    probe.font = font;
    const w = Math.ceil(probe.measureText(text).width) + 16 * scale;
    const h = 34 * scale;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + 2);
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace; t.minFilter = LinearFilter; t.generateMipmaps = false;
    return { texture: t, aspect: w / h };
  }, [text, color, weight]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={position} scale={[height * aspect, height, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}
