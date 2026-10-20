// Brand colour helpers shared by the server (theme variables, upload validation) and the settings form (live preview).
// The chosen colour becomes the "700" shade; the lighter and darker shades are derived from it so the whole interface follows.

export const DEFAULT_PRIMARY = "#7f1519";

const parse = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (hex: string, other: [number, number, number], amount: number) => toHex(parse(hex).map((v, i) => v + (other[i] - v) * amount));

export const isHexColor = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

/** WCAG relative luminance contrast of white text on this colour. Buttons and badges use white text on the primary colour. */
export function contrastWithWhite(hex: string): number {
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = parse(hex).map(lin);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05);
}

export const MIN_CONTRAST = 4.5;

export function brandShades(primary: string): Record<"50" | "100" | "600" | "700" | "800", string> {
  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [0, 0, 0];
  return { "50": mix(primary, white, 0.95), "100": mix(primary, white, 0.88), "600": mix(primary, white, 0.1), "700": primary.toLowerCase(), "800": mix(primary, black, 0.25) };
}

export function themeCss(primary: string): string {
  const s = brandShades(primary);
  return `:root{--brand-50:${s["50"]};--brand-100:${s["100"]};--brand-600:${s["600"]};--brand-700:${s["700"]};--brand-800:${s["800"]};}`;
}
