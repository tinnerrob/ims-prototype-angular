import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ModalDismissDirective } from '../modal-dismiss/modal-dismiss.directive';

/**
 * One label/value pair in the read-only record viewer.
 * `mono` renders the value in the monospace face (ids, codes, ranges).
 */
export interface ViewField {
  label: string;
  value: string;
  mono?: boolean;
}

/** A titled group of fields (the viewer stacks several of these). */
export interface ViewSection {
  title?: string;
  fields: ViewField[];
}

/** Everything the viewer needs to render one record. */
export interface ViewModel {
  title: string;
  subtitle?: string;
  /** Bootstrap icon class (e.g. `bi-box-seam`). Defaults to `bi-eye`. */
  icon?: string;
  /** Optional status badge text. */
  badge?: string;
  /** Badge modifier (`st-active`, `st-out`, …); defaults to `st-on`. */
  badgeClass?: string;
  sections: ViewSection[];
}

/**
 * True when a click landed on an interactive control *inside* a clickable table
 * row, so the row's own click handler can ignore it — buttons, links and form
 * controls keep their own behaviour.
 */
export function isInteractiveTarget(e: Event): boolean {
  const el = e.target as Element | null;
  return !!el?.closest('button, a, input, select, textarea, label, .form-check');
}

/**
 * Read-only record viewer — the shared modal behind every clickable table row
 * (`<tr class="row-open" (click)="showView($event, record)">`).
 *
 * The host page supplies the title/sections; the viewer only renders them, in
 * the same `modal → modal-dialog → modal-content` shell as the per-page
 * editors, so a row click never has to open an editable form by accident. The
 * optional footer `Edit` action hands control back to the page's own editor;
 * the corner ✕ or a click outside the dialog closes it.
 */
@Component({
  selector: 'ims-record-view',
  standalone: true,
  imports: [ModalDismissDirective],
  templateUrl: './record-view.component.html',
  styleUrl: './record-view.component.scss',
})
export class RecordViewComponent {
  /** The record to show; `null` closes the viewer. */
  @Input() view: ViewModel | null = null;
  /** Show the footer `Edit` action (the host wires `edit` to its editor). */
  @Input() editable = false;

  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly edit = new EventEmitter<void>();
}
