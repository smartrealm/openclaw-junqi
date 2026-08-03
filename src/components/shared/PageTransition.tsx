// ═══════════════════════════════════════════════════════════
// PageTransition — shared route-scene entrance
// The route viewport owns scrolling, so only the page scene moves.
// ═══════════════════════════════════════════════════════════

import type { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

export function PageTransition({ children, className = '' }: PageTransitionProps) {
  return (
    <div className={`aegis-page-transition animate-fade-in ${className}`}>
      {children}
    </div>
  );
}
