import { Component, ElementRef, EventEmitter, inject, Input, Output } from '@angular/core';

import { PrintMenuService } from './print-menu.service';
import { PrintMode } from './print.service';

/**
 * `<ims-print-menu>` — the print action, as a button with a menu.
 *
 * Renders the icon the tables have always used plus a small **down chevron**, and
 * opens the Print / Save to PDF menu (see `PrintMenuService` for why the panel is
 * drawn from the app root rather than here). The host emits the chosen mode, so a
 * page keeps one builder and takes the mode as an argument:
 *
 * ```html
 * <ims-print-menu label="Print order" (action)="printOrder(o, $event)"></ims-print-menu>
 * ```
 */
@Component({
  selector: 'ims-print-menu',
  standalone: true,
  templateUrl: './print-menu.component.html',
  styleUrl: './print-menu.component.scss',
})
export class PrintMenuComponent {
  /** Accessible name / tooltip for the button (`Print order`, `Print invoice`). */
  @Input() label = 'Print';
  /** Optional visible label, for the footer of an editor (row actions stay icon-only). */
  @Input() text = '';
  /** Render as the primary button (a modal footer) instead of the outline chip. */
  @Input() primary = false;
  /**
   * Offer the expanded detail levels too (Print — expanded / Save to PDF —
   * expanded). Only the reports that can print a line-level version set it.
   */
  @Input() expandable = false;
  /** The chosen menu item. */
  @Output() readonly action = new EventEmitter<PrintMode>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly menus = inject(PrintMenuService);

  /** This button's anchor while *its* menu is the open one (identity, not geometry). */
  private anchor: DOMRect | null = null;

  open(): boolean {
    return !!this.anchor && this.menus.menu()?.anchor === this.anchor;
  }

  toggle(): void {
    if (this.open()) {
      this.menus.close();
      return;
    }
    const anchor = this.host.nativeElement.getBoundingClientRect();
    this.anchor = anchor;
    this.menus.open(anchor, (mode) => this.action.emit(mode), this.expandable);
  }
}
