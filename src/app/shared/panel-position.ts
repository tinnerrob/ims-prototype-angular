/* Anchored-panel placement — one algorithm for the two floating panels the app
   draws at its root (`ims-tip`, `ims-print-menu-host`).
   ---------------------------------------------------------------------------
   Both panels hang off a trigger's viewport rect: biased to one edge of the
   anchor, clamped inside the viewport, and flipped above the anchor when there is
   no room below (a calendar row near the bottom of the screen). The geometry was
   written out twice; it lives here once, so a fix to the flip rule cannot reach
   one panel and miss the other. */

/** Where a panel ended up, in viewport coordinates. */
export interface PanelPlacement {
  top: number;
  left: number;
  /** True when the panel had to flip above its anchor (no room below). */
  above: boolean;
}

export interface PanelPlacementOptions {
  /** Space between the anchor and the panel. */
  gap?: number;
  /** Minimum margin kept from every viewport edge. */
  pad?: number;
  /** Which edge of the anchor the panel's left edge follows. */
  align?: 'left' | 'right';
}

/**
 * Measure `el` and place it against `anchor`.
 *
 * The panel's own `offsetWidth`/`offsetHeight` are read directly, so this must run
 * after the panel has rendered its content (both hosts call it from a
 * `requestAnimationFrame`, since the DOM only carries new content on the next
 * frame) — the measurement is why the hosts keep the panel invisible until `pos`
 * is set, rather than flashing it at the wrong spot for a frame.
 */
export function placePanel(
  el: HTMLElement,
  anchor: DOMRect,
  opts: PanelPlacementOptions = {},
): PanelPlacement {
  const gap = opts.gap ?? 8;
  const pad = opts.pad ?? 10;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const wanted = opts.align === 'right' ? anchor.right - w : anchor.left;
  const left = Math.max(pad, Math.min(wanted, vw - w - pad));

  let top = anchor.bottom + gap;
  let above = false;
  if (top + h + pad > vh && anchor.top - gap - h >= pad) {
    top = anchor.top - gap - h;
    above = true;
  } else {
    top = Math.max(pad, Math.min(top, vh - h - pad));
  }
  return { top, left, above };
}
