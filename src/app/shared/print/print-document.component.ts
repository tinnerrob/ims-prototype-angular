import { Component, inject } from '@angular/core';

import { SessionService } from '../../core/session.service';
import { PrintService } from './print.service';

/**
 * `<ims-print-document>` — the one printable-document renderer, mounted at the
 * app root (see `PrintService`). It renders whatever document is being printed —
 * a flat table, or a grouped report whose every group carries its own header and
 * subtotal (see `PrintGroup`); the `@media print` rules hide the app shell and
 * leave this alone, so every report prints through one layout and one set of
 * styles.
 */
@Component({
  selector: 'ims-print-document',
  standalone: true,
  templateUrl: './print-document.component.html',
  styleUrl: './print-document.component.scss',
})
export class PrintDocumentComponent {
  readonly prints = inject(PrintService);
  private readonly session = inject(SessionService);

  /** Stamp on the footer — the day the document was printed. */
  readonly today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  /** The workspace the document is issued by (the letterhead's second line). */
  tenantName(): string {
    return this.session.tenant()?.name ?? 'IMS';
  }
}
