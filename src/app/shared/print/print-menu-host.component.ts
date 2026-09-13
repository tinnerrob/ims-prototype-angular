import { Component, computed, effect, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';

import { placePanel } from '../panel-position';
import { PrintMenuService } from './print-menu.service';
import { PrintMode } from './print.service';

/** Where the panel ended up (fixed, in viewport coordinates). */
interface MenuPos {
  top: number;
  left: number;
}

/** One rendered menu entry. */
interface MenuEntry {
  mode: PrintMode;
  icon: string;
  label: string;
  hint: string;
}

/**
 * `<ims-print-menu-host>` — the one print menu panel, mounted at the app root
 * beside the confirm dialog and the tip panel (see `PrintMenuService` for why).
 *
 * It hangs under the button that opened it (flipping above when there is no room
 * below), clamps inside the viewport, and closes on a click anywhere off it or on
 * Escape. Like the tip, it stays invisible until it has measured itself, so it
 * never flashes in the wrong spot for a frame.
 */
@Component({
  selector: 'ims-print-menu-host',
  standalone: true,
  templateUrl: './print-menu-host.component.html',
  styleUrl: './print-menu-host.component.scss',
})
export class PrintMenuHostComponent {
  readonly menus = inject(PrintMenuService);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Panel placement; null until measured. */
  readonly pos = signal<MenuPos | null>(null);

  /** The entries to render: the two standards, plus the detail levels when offered. */
  readonly items = computed<MenuEntry[]>(() => {
    const menu = this.menus.menu();
    if (!menu) return [];
    const base: MenuEntry[] = [
      { mode: 'print', icon: 'bi-printer', label: 'Print', hint: 'Open the print dialog' },
      { mode: 'pdf', icon: 'bi-file-earmark-pdf', label: 'Save to PDF', hint: 'Print, choosing “Save as PDF”' },
    ];
    if (!menu.expandable) return base;
    return [
      ...base,
      { mode: 'print-expanded', icon: 'bi-arrows-expand', label: 'Print — expanded', hint: 'One row per booked item' },
      { mode: 'pdf-expanded', icon: 'bi-file-earmark-pdf', label: 'Save to PDF — expanded', hint: 'One row per booked item' },
    ];
  });

  constructor() {
    effect(() => {
      const menu = this.menus.menu();
      this.pos.set(null); // hide while the new panel is measured
      if (!menu) return;
      requestAnimationFrame(() => this.place(menu.anchor));
    });
  }

  pick(mode: PrintMode): void {
    this.menus.pick(mode);
  }

  close(): void {
    this.menus.close();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.menus.close();
  }

  private place(anchor: DOMRect): void {
    const el = this.panel()?.nativeElement;
    if (!el) return;
    // Right-aligned on the opener's trailing edge; the flip-above rule is shared
    // with the tooltip panel (`placePanel()`).
    const { top, left } = placePanel(el, anchor, { gap: 6, pad: 8, align: 'right' });
    this.pos.set({ top, left });
  }
}
