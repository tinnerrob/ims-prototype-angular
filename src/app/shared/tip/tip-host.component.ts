import { Component, ElementRef, effect, signal, viewChild } from '@angular/core';

import { PanelPlacement, placePanel } from '../panel-position';
import { TipLine, TipService } from './tip.service';

/**
 * The single tooltip panel, mounted once in the app shell next to the confirm
 * dialog. It renders whatever `TipService` holds, positioned against the
 * anchor's viewport rect (`placePanel()` — the shared rule, also used by the
 * print menu):
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
  readonly pos = signal<PanelPlacement | null>(null);

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
    if (el) this.pos.set(placePanel(el, anchor));
  }
}
