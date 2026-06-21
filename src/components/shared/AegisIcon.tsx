/**
 * AegisIcon — theme-aware inline SVG icons for the design system.
 *
 * 10 icon kinds, each with a distinctive silhouette + color mapping:
 *
 *   Dashboard hero cards:
 *     cost     — concentric circles + $ (primary)
 *     month    — trend polyline + green dot (primary → success)
 *     tokens   — lightning bolt + glow rings (warning)
 *     context  — chip with dashed border + indicator dot (danger)
 *
 *   Section headers & nav markers:
 *     globe    — circles + lat/long lines (primary)
 *     moon     — crescent (primary)
 *     bell     — bell shape + clapper (warning)
 *     type     — "T" letterform (primary)
 *     folder   — tabbed folder (primary)
 *     cpu      — rect grid + dot (accent, identical to context shape)
 *
 * Design principles:
 *   - All colors via CSS custom properties → auto-adapt to 4 themes.
 *   - Zero external deps (no lucide-react overhead).
 *   - `size` drives the rendered dimensions; viewBox is fixed at 24.
 *   - Semantic opacity layers so the icon reads at 10px and 24px.
 *   - `<span>` wrapper + `aria-hidden` keeps it inert to screen readers.
 *
 * Usage:
 *   <AegisIcon kind="globe"  size={16} />
 *   <AegisIcon kind="folder" size={15} />
 */

import React from "react";

export type AegisIconKind =
  | "cost" | "month" | "tokens" | "context"
  | "globe" | "moon" | "bell" | "type" | "folder" | "cpu"
  | "wifi" | "wifi-off";

interface Props {
  kind: AegisIconKind;
  size?: number;
  className?: string;
}

export const AegisIcon = React.memo(function AegisIcon({
  kind,
  size = 14,
  className,
}: Props) {
  return (
    <span
      className={className}
      style={{ display: "inline-flex", width: size, height: size, flexShrink: 0 }}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {kind === "cost"     && <Cost />}
        {kind === "month"    && <Month />}
        {kind === "tokens"   && <Tokens />}
        {kind === "context"  && <Context />}
        {kind === "globe"    && <Globe />}
        {kind === "moon"     && <Moon />}
        {kind === "bell"     && <Bell />}
        {kind === "type"     && <Type />}
        {kind === "folder"   && <Folder />}
        {kind === "cpu"      && <Context />} {/* same silhouette */}
        {kind === "wifi"     && <Wifi on />}
        {kind === "wifi-off" && <Wifi on={false} />}
      </svg>
    </span>
  );
});

/* ──────────────── Shared helpers ──────────────── */

/**
 * Returns the RGB channel string for a given aegis semantic color,
 * so callers can compose `rgb(var / alpha)` in SVG attributes.
 * Falls back gracefully when the CSS var is absent (SSR/preview).
 */
const rgb = (name: string) => `rgb(var(--aegis-${name}))`;

const r = (name: string, alpha: number) => `rgb(var(--aegis-${name})/${alpha})`;

/* ─────────── Dashboard hero cards ─────────── */

function Cost() {
  return (
    <>
      <circle cx="12" cy="12" r="10" fill={r("primary", 0.15)} />
      <circle cx="12" cy="12" r="6.5" fill={r("primary", 0.25)} />
      <text x="12" y="16.5" textAnchor="middle" fontSize="11" fontWeight="700" fill={rgb("primary")}>$</text>
    </>
  );
}

function Month() {
  return (
    <>
      <circle cx="12" cy="12" r="10" fill={r("primary", 0.06)} />
      <polyline points="3,17 8,12 13,14.5 21,7" fill="none" stroke={rgb("primary")} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      <circle cx="21" cy="7" r="2.5" fill={r("success", 0.7)} />
    </>
  );
}

function Tokens() {
  return (
    <>
      <circle cx="12" cy="12" r="10" fill={r("warning", 0.06)} />
      <circle cx="12" cy="12" r="7" fill={r("warning", 0.04)} />
      <path d="M13 2L5 13h5.5L9 22l9-12h-5.5L13 2z" fill={r("warning", 0.18)} stroke={rgb("warning")} strokeWidth="1.6" strokeLinejoin="round" />
    </>
  );
}

function Context() {
  return (
    <>
      <rect x="2.5" y="2.5" width="19" height="19" rx="4" fill={r("danger", 0.06)} stroke={rgb("danger")} strokeWidth="1.5" strokeDasharray="3 2" />
      <rect x="5" y="6.5" width="14" height="2.5" rx="1.2" fill={r("danger", 0.18)} />
      <rect x="5" y="11" width="10" height="2" rx="1" fill={r("danger", 0.13)} />
      <rect x="5" y="15" width="12" height="2" rx="1" fill={r("danger", 0.10)} />
      <circle cx="19.5" cy="4.5" r="3" fill={r("danger", 0.22)} />
      <circle cx="19.5" cy="4.5" r="1.5" fill={rgb("danger")} />
    </>
  );
}

/* ─────────── Section headers & nav markers ─────────── */

function Globe() {
  return (
    <>
      <circle cx="12" cy="12" r="9.5" fill={r("primary", 0.06)} stroke={rgb("primary")} strokeWidth="1.4" />
      <ellipse cx="12" cy="12" rx="5" ry="9.5" fill="none" stroke={rgb("primary")} strokeWidth="1" opacity="0.5" />
      <line x1="2.5" y1="12" x2="21.5" y2="12" stroke={rgb("primary")} strokeWidth="1" opacity="0.5" />
    </>
  );
}

function MoonIcon() {
  return (
    <>
      <circle cx="12" cy="12" r="10" fill={r("primary", 0.08)} />
      <path d="M20 15.5A7 7 0 018.5 4 7.5 7.5 0 0020 15.5z" fill={r("primary", 0.25)} stroke={rgb("primary")} strokeWidth="1.5" strokeLinejoin="round" />
    </>
  );
}
const Moon = MoonIcon;

function Bell() {
  return (
    <>
      <circle cx="12" cy="12" r="10" fill={r("warning", 0.06)} />
      <path d="M8 10a4 4 0 018 0v3l2 2v1H6v-1l2-2v-3z" fill={r("warning", 0.12)} stroke={rgb("warning")} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="18" cy="7" r="2.5" fill={r("warning", 0.25)} stroke={rgb("warning")} strokeWidth="1" />
    </>
  );
}

function Type() {
  return (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" fill={r("primary", 0.06)} stroke={rgb("primary")} strokeWidth="1.4" strokeDasharray="2 2" />
      <text x="12" y="16" textAnchor="middle" fontSize="12" fontWeight="700" fill={rgb("primary")}>T</text>
    </>
  );
}

function Folder() {
  return (
    <>
      <path d="M2 7a3 3 0 013-3h4l3 2.5h7a3 3 0 013 3v7a3 3 0 01-3 3H5a3 3 0 01-3-3V7z" fill={r("primary", 0.1)} stroke={rgb("primary")} strokeWidth="1.4" strokeLinejoin="round" />
    </>
  );
}

function Wifi({ on }: { on: boolean }) {
  if (!on) {
    return (
      <>
        <circle cx="12" cy="12" r="10" fill={r("danger", 0.06)} />
        <path d="M1.5 7.5l21 9M22.5 7.5l-21 9" stroke={rgb("danger")} strokeWidth="2" opacity="0.5" />
      </>
    );
  }
  return (
    <>
      <circle cx="12" cy="12" r="10" fill={r("success", 0.06)} />
      <path d="M5 10.5a7 7 0 0114 0" fill="none" stroke={rgb("success")} strokeWidth="2" strokeLinecap="round" opacity="0.4" />
      <path d="M7.5 13.5a3.5 3.5 0 019 0" fill="none" stroke={rgb("success")} strokeWidth="2" strokeLinecap="round" opacity="0.65" />
      <circle cx="12" cy="18" r="1.8" fill={rgb("success")} opacity="0.8" />
    </>
  );
}
