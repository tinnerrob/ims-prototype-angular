import { Injectable, signal } from '@angular/core';

/**
 * One line of tooltip content.
 *
 * - a bare `string` is a full-width datum (the "one fact per line" style the
 *   scheduler's order tooltip established: `8/1/26 10:00am → 8/1/26 4:30pm`);
 * - `{ label, value }` renders as an aligned pair (`Status   Available`), which
 *   is what records with several short fields want.
 */
export type TipLine = string | { label: string; value: string };

/** Everything one tooltip renders: a headline, then one datum per line. */
export interface Tip {
  /** Headline — `ORD-1042 — Riverside Pump Station`, `EXC-220 — CAT 320`. */
  title: string;
  /** Optional muted second headline (customer, owner). */
  subtitle?: string;
  /** One fact per line; the shape every tip in the app shares. */
  lines?: TipLine[];
  /** Optional status chip shown next to the title. */
  badge?: string;
  /** Chip modifier (`st-available`, `st-on`, `st-out`, …). */
  badgeClass?: string;
}

/**
 * Holds the single tooltip that is currently being shown, and its anchor.
 *
 * One tooltip exists for the whole app because tips must escape the panes they
 * belong to: calendar bars, table cells and label columns all sit inside
 * `overflow: hidden` scrollers, so a panel rendered next to its trigger would be
 * clipped. The host renders at the app root with `position: fixed` instead —
 * the same reason the native `title` tooltips read correctly before.
 *
 * `TipDirective` pushes into this service; `TipHostComponent` renders it.
 */
@Injectable({ providedIn: 'root' })
export class TipService {
  /** The tip to render, or null when nothing is hovered. */
  readonly tip = signal<Tip | null>(null);

  /** Viewport rect of the element the tip is anchored to. */
  readonly anchor = signal<DOMRect | null>(null);

  show(tip: Tip, anchor: DOMRect): void {
    this.anchor.set(anchor);
    this.tip.set(tip);
  }

  hide(): void {
    this.tip.set(null);
    this.anchor.set(null);
  }
}
