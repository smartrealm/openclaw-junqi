/**
 * DashboardIcon — theme-aware inline SVG icons for the 4 hero stat cards.
 *
 * Design principles:
 *   - All colors are CSS variables → auto-adapt to dark/midnight/light/eyecare.
 *   - Zero external dependencies (no lucide-react icon lib overhead).
 *   - `size` drives the viewBox scale; 13px matches the original lucide sizes.
 *   - Inner shapes use semantic opacity layers so the icon reads at 12px and 24px.
 *
 * Usage:
 *   <DashboardIcon kind="cost"   size={13} />
 *   <DashboardIcon kind="month"  size={13} />
 *   <DashboardIcon kind="tokens" size={13} />
 *   <DashboardIcon kind="context" size={13} />
 */

import React from "react";

type IconKind = "cost" | "month" | "tokens" | "context";

interface Props {
  kind: IconKind;
  size?: number;
  className?: string;
}

export const DashboardIcon = React.memo(function DashboardIcon({
  kind,
  size = 13,
  className,
}: Props) {
  const vb = 24; // fixed viewBox, scale via container size
  return (
    <span
      className={className}
      style={{ display: "inline-flex", width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${vb} ${vb}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {kind === "cost" && <CostPath />}
        {kind === "month" && <MonthPath />}
        {kind === "tokens" && <TokensPath />}
        {kind === "context" && <ContextPath />}
      </svg>
    </span>
  );
});

/* ── Cost — concentric circles + dollar sign ── */
function CostPath() {
  return (
    <>
      <circle cx="12" cy="12" r="10" fill="var(--aegis-primary-glow, rgb(var(--aegis-primary)/0.15))" />
      <circle cx="12" cy="12" r="6.5" fill="var(--aegis-primary-surface, rgb(var(--aegis-primary)/0.25))" />
      <text
        x="12" y="16.5"
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fill="rgb(var(--aegis-primary))"
      >
        $
      </text>
    </>
  );
}

/* ── Month — trend line (polyline) + green endpoint dot ── */
function MonthPath() {
  return (
    <>
      {/* Subtle background circle */}
      <circle cx="12" cy="12" r="10" fill="rgb(var(--aegis-primary)/0.06)" />
      {/* Trend polyline: bottom-left → up-right */}
      <polyline
        points="3,17 8,12 13,14.5 21,7"
        fill="none"
        stroke="rgb(var(--aegis-primary))"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
      {/* Endpoint dot — green success tint signals "growth is good" */}
      <circle
        cx="21" cy="7" r="2.5"
        fill="rgb(var(--aegis-success))"
        opacity="0.7"
      />
    </>
  );
}

/* ── Tokens — lightning bolt + subtle outer glow ring ── */
function TokensPath() {
  return (
    <>
      {/* Glow ring */}
      <circle cx="12" cy="12" r="10" fill="rgb(var(--aegis-warning)/0.06)" />
      <circle cx="12" cy="12" r="7" fill="rgb(var(--aegis-warning)/0.04)" />
      {/* Bolt — classic zap shape */}
      <path
        d="M13 2L5 13h5.5L9 22l9-12h-5.5L13 2z"
        fill="rgb(var(--aegis-warning)/0.18)"
        stroke="rgb(var(--aegis-warning))"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </>
  );
}

/* ── Context — chip with dashed border + inner lines + indicator dot ── */
function ContextPath() {
  return (
    <>
      {/* Outer chip */}
      <rect
        x="2.5" y="2.5" width="19" height="19" rx="4"
        fill="rgb(var(--aegis-danger)/0.06)"
        stroke="rgb(var(--aegis-danger))"
        strokeWidth="1.5"
        strokeDasharray="3 2"
      />
      {/* Inner text lines */}
      <rect x="5" y="6.5" width="14" height="2.5" rx="1.2" fill="rgb(var(--aegis-danger)/0.18)" />
      <rect x="5" y="11" width="10" height="2" rx="1" fill="rgb(var(--aegis-danger)/0.13)" />
      <rect x="5" y="15" width="12" height="2" rx="1" fill="rgb(var(--aegis-danger)/0.10)" />
      {/* Status dot — top right */}
      <circle cx="19.5" cy="4.5" r="3" fill="rgb(var(--aegis-danger)/0.22)" />
      <circle cx="19.5" cy="4.5" r="1.5" fill="rgb(var(--aegis-danger))" />
    </>
  );
}
