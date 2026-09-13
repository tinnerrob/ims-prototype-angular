import { Injectable, signal } from '@angular/core';

import { PrintMode } from './print.service';

/** The print menu that is open: where its button is, and what picking an item does. */
export interface PrintMenuState {
  /** Viewport rect of the button the menu hangs from. */
  anchor: DOMRect;
  /** Offer the two `-expanded` detail levels as well (schedules, timesheets). */
  expandable: boolean;
  /** The page's own handler — emits the chosen mode to the host that opened it. */
  choose: (mode: PrintMode) => void;
}

/**
 * IMS — PrintMenuService.
 *
 * One print menu, rendered at the app root beside the confirm dialog and the tip
 * panel — the same reason those live there: a dropdown drawn inside the button
 * would be **clipped** by the pane it sits in (every list is a `.table-wrap` with
 * `overflow-x: auto`, and a table row can also sit inside a modal). Anchoring it
 * to the opener's viewport rect and drawing it from a fixed root host sidesteps
 * all of that, and keeps the rule in one place instead of per page.
 */
@Injectable({ providedIn: 'root' })
export class PrintMenuService {
  /** The open menu, or null. */
  readonly menu = signal<PrintMenuState | null>(null);

  open(anchor: DOMRect, choose: (mode: PrintMode) => void, expandable = false): void {
    this.menu.set({ anchor, expandable, choose });
  }

  close(): void {
    this.menu.set(null);
  }

  /** Run the opener's handler for the chosen item, then close. */
  pick(mode: PrintMode): void {
    const open = this.menu();
    this.close();
    open?.choose(mode);
  }
}
