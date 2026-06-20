/**
 * cn — className merge helper (clsx + tailwind-merge).
 * Used by shadcn/ui components so later Tailwind classes override earlier ones.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
