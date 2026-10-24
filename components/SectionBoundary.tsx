"use client";

import { Component, type ReactNode } from "react";

/**
 * SectionBoundary — one broken section must never white-screen a whole
 * page (Ethan, Oct 23, 2026: the Market Intel page went down entirely).
 * Catches a render error in its children, shows a compact inline notice
 * carrying the error message, and leaves the rest of the page usable.
 */
export default class SectionBoundary extends Component<
  { label: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error(`[SectionBoundary:${this.props.label}]`, error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
          role="alert"
        >
          <p className="font-semibold">{this.props.label} couldn’t render.</p>
          <p className="mt-0.5 text-xs opacity-80">{this.state.error.message}</p>
        </div>
      );
    }
    return <>{this.props.children}</>;
  }
}
