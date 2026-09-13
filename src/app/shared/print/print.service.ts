import { Injectable, signal } from '@angular/core';

/**
 * How the print dialog was asked for. Both destinations go through the browser's
 * own dialog — there is no PDF library in this app — but the dialog's *destination*
 * is what saves a PDF, and it names that file after the page title.
 *
 * `-expanded` is the detail level, not another destination: a schedule or a
 * timesheet can print contracted (one row per asset inside its order / per order
 * inside its employee) or expanded (one row per booking / per logged segment).
 * Only the reports that offer a detail choice render those two extra menu items.
 */
export type PrintMode = 'print' | 'pdf' | 'print-expanded' | 'pdf-expanded';

/** True when the chosen item asks for the expanded (line-level) document. */
export function wantsExpanded(mode: PrintMode): boolean {
  return mode.endsWith('expanded');
}

/** One label/value pair in a printable document's header block
 * (a date, a customer, a window — the facts that sit beside the title). */
export interface PrintField {
  label: string;
  value: string;
}

/** A counterparty block (Bill To / Supplier / For) on a printable document. */
export interface PrintBlock {
  /** `Bill To`, `Supplier`, `Customer`. */
  title: string;
  /** The party's name (the line that leads the block). */
  name: string;
  /** Address / contact lines under the name. */
  lines: string[];
}

/** A line in the document's money footer (`Subtotal`, `Tax`, `Total`). */
export interface PrintTotal {
  label: string;
  value: string;
  /** Emphasise the row (the grand total). */
  strong?: boolean;
}

/**
 * A group in a printable report: a heading, its rows, its own subtotals, and an
 * optional second level.
 *
 * A report has **one** `columns` legend all the way down. `rows` is a flat table;
 * `groups` is for a document that *has a shape* — a schedule is orders of assets, a
 * timesheet is employees of orders. The renderer repeats the header per group and
 * prints the group's subtotal under it, so a reader meets the total for the primary
 * thing (the order, the employee) before the detail that makes it up.
 */
export interface PrintGroup {
  /** The heading — `ORD-1042 · Riverside Pump Station`, `EMP-001 · Dana Whitfield`. */
  title: string;
  /** Optional facts printed beside the heading (customer + window, role + hours). */
  meta?: string;
  /** This group's own rows (omit when it only holds `subgroups`). */
  rows?: string[][];
  /** The group's subtotal — the primary's total. */
  subtotals?: PrintTotal[];
  /** The optional second level (a schedule's assets inside an order). */
  subgroups?: PrintGroup[];
}

/**
 * A printable document, described as *data* rather than markup.
 *
 * Every printed report — an invoice, a purchase order, an order, a pick list, a
 * schedule — is the same shape: a titled header, a counterparty block, a table of
 * lines, a money footer and a note. Pages build one of these and hand it to
 * `PrintService.print()`; `<ims-print-document>` renders it. So a new report is
 * a builder function, not a new component — the same argument the form builder
 * makes for forms.
 */
export interface PrintDocument {
  /** `INVOICE`, `PURCHASE ORDER`, `ORDER`, `PICK LIST`. */
  heading: string;
  /** The document's own number/id (`INV-001`, `PO-2026-001`). */
  number: string;
  /** Optional status chip text (`Paid`, `Draft`, `Active`). */
  status?: string;
  party?: PrintBlock;
  /** The facts that sit in the header grid. */
  meta: PrintField[];
  /** The line-item table's headers — the legend for `rows` *and* `groups`. */
  columns: string[];
  /** Per-column alignment, parallel to `columns`; omitted columns read left. */
  align?: ('left' | 'right')[];
  /** A flat table's cells (omit when the document uses `groups`). */
  rows?: string[][];
  /** A grouped report, with a subtotal per primary (omit when the document is flat). */
  groups?: PrintGroup[];
  totals?: PrintTotal[];
  notes?: string;
}

/**
 * IMS — PrintService.
 *
 * The single printable document currently on the printer (or null), plus the
 * trigger. Mirrors `TipService` / `ConfirmService`: a page *builds* a
 * `PrintDocument` and calls `print()`, and the one `<ims-print-document>` host
 * mounted at the app root renders it. The host lives *outside* the app shell so
 * the `@media print` rules can hide the shell and leave only the document —
 * the same reason the tooltip panel is `position: fixed` at the root.
 */
@Injectable({ providedIn: 'root' })
export class PrintService {
  /** The document to render, or null when nothing is being printed. */
  readonly doc = signal<PrintDocument | null>(null);

  /**
   * Show `doc` and open the browser's print dialog.
   *
   * The document is set first and the dialog is opened on the next tick, so the
   * host has rendered (and laid out) by the time the print preview snapshots the
   * page — otherwise the preview can capture an empty document.
   *
   * `mode` is which menu item was chosen (`print` / `pdf`). Both open the same
   * dialog; what the choice changes is the *title*: the browser names a saved PDF
   * (and the printed header/footer) after the page title, so it is set to the
   * document's heading and number while the dialog is up and restored after.
   */
  print(doc: PrintDocument, mode: PrintMode = 'print'): void {
    this.doc.set(doc);
    const previous = typeof document === 'undefined' ? '' : document.title;
    if (typeof document !== 'undefined') document.title = `${doc.heading} ${doc.number}`;
    setTimeout(() => {
      try {
        window.print();
      } finally {
        // Restore even if the dialog throws (a blocker, a headless runner): leaving
        // the tab titled after the document would outlive the print.
        if (typeof document !== 'undefined') document.title = previous;
      }
    }, 50);
  }

  clear(): void {
    this.doc.set(null);
  }
}
