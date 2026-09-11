import { Component, ElementRef, effect, signal, viewChild } from '@angular/core';

import { TipLine, TipService } from './tip.service';

/** Where the panel ended up, and whether it had to flip above its anchor. */
interface TipPos {
  top: number;
  left: number;
  above: boolean;
}

/**
 * The single tooltip panel, mounted once in the app shell next to the confirm
 * dialog. It renders whatever `TipService` holds, positioned against the
 * anchor's viewport rect:
 *
 *   - below the trigger, biased to its left edge, clamped to the viewport;
 *   - flipped above when there is no room below (calendar rows near the bottom);
 *   - invisible until it has measured itself, so it never flashes at the wrong
 *     spot for a frame (opacity, not `display`, so the measurement is real).
 *
 * `pointer-events: none` keeps it out of the way of the hover that opened it —
 * the trigger stays hovered while the tip is up, and a drag never hits it.
 */
@Component({
  selector: 'ims-tip',
  standalone: true,
  templateUrl: './tip-host.component.html',
  styleUrl: './tip-host.component.scss',
})
export class TipHostComponent {
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Panel placement; null until measured. */
  readonly pos = signal<TipPos | null>(null);

  constructor(readonly tips: TipService) {
    effect(() => {
      const tip = this.tips.tip();
      const anchor = this.tips.anchor();
      this.pos.set(null); // hide while the new content is measured
      if (!tip || !anchor) return;
      /* the DOM only carries the new content on the next frame */
      requestAnimationFrame(() => this.place(anchor));
    });
  }

  /** `label`/`value` rows render as a pair; bare strings as one line of text. */
  isPair(line: TipLine): line is { label: string; value: string } {
    return typeof line !== 'string';
  }

  private place(anchor: DOMRect): void {
    const el = this.panel()?.nativeElement;
    if (!el) return;
    const gap = 8;
    const pad = 10;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const left = Math.max(pad, Math.min(anchor.left, vw - w - pad));
    let top = anchor.bottom + gap;
    let above = false;
    if (top + h + pad > vh && anchor.top - gap - h >= pad) {
      top = anchor.top - gap - h;
      above = true;
    } else {
      top = Math.max(pad, Math.min(top, vh - h - pad));
    }
    this.pos.set({ top, left, above });
  }
}
