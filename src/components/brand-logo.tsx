import clsx from "clsx";

export const LOGO_MIN_HEIGHT = 16;
export const LOGO_MAX_HEIGHT = 64;
export const LOGO_DEFAULT_HEIGHT = 32;

/**
 * The organisation's logo at the height the Super Admin chose, keeping the picture's own proportions: a wide wordmark stays wide and a
 * square mark stays square. It is never cropped or squeezed into a fixed box. `onDark` adds a light backing that hugs the picture, for
 * logos that would disappear on the dark sign-in panel.
 */
export function BrandLogo({ src, height = LOGO_DEFAULT_HEIGHT, onDark = false, className }: { src: string; height?: number; onDark?: boolean; className?: string }) {
  const h = Math.min(LOGO_MAX_HEIGHT, Math.max(LOGO_MIN_HEIGHT, Math.round(height)));
  return (
    <span className={clsx("inline-flex shrink-0 items-center", onDark && "rounded-lg bg-white p-1.5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" style={{ height: h }} className="w-auto max-w-[min(60vw,16rem)] object-contain" />
    </span>
  );
}
