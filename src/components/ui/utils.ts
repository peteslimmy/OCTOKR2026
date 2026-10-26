import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with conflict resolution. Use this everywhere instead of raw clsx. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}