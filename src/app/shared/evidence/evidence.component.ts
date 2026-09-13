import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { Document, DocumentKind, DocumentScope, DOCUMENT_KINDS } from '../../core/models';

/**
 * `<ims-evidence>` (B8) — the shared evidence panel.
 *
 * Lists the documents attached to a record and, unless `readOnly`, lets one be
 * attached (a kind and a caption) or removed. The port has **no file store**, so a
 * caption-only row *is* the evidence: the scoping, the rows and the derived count
 * are real, and swapping in the API's blob store changes only what `url` holds.
 * Used by the inspection editor; the record viewers list the same rows read-only.
 */
@Component({
  selector: 'ims-evidence',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './evidence.component.html',
  styleUrl: './evidence.component.scss',
})
export class EvidenceComponent {
  /** What the documents hang off (`item` / `inspection` / `receipt`). */
  @Input() scope: DocumentScope = 'inspection';
  /** The record's id; nothing renders until it is set. */
  @Input() refId = '';
  /** List only (a record viewer). */
  @Input() readOnly = false;
  /** Emitted after an attach or a remove, so a host can refresh. */
  @Output() changed = new EventEmitter<void>();

  readonly kinds = DOCUMENT_KINDS;
  /** The attach form's own fields. */
  draft: { kind: DocumentKind; caption: string } = { kind: 'photo', caption: '' };

  constructor(readonly data: DataService) {}

  documents(): Document[] {
    return this.refId ? this.data.documentsFor(this.scope, this.refId) : [];
  }

  add(): void {
    if (!this.refId || !this.draft.caption.trim()) return;
    this.data.createDocument({
      scope: this.scope,
      refId: this.refId,
      kind: this.draft.kind,
      caption: this.draft.caption.trim(),
    });
    this.draft = { kind: 'photo', caption: '' };
    this.changed.emit();
  }

  remove(d: Document): void {
    this.data.removeDocument(d.id);
    this.changed.emit();
  }

  sizeLabel(d: Document): string {
    return d.size ? `${Math.round(d.size / 1024)} KB` : '—';
  }
}
