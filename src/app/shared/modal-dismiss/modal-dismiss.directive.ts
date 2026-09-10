import { Directive, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core';

import { ConfirmService } from '../confirm/confirm.service';

/**
 * The close policy of the hand-rolled modals, in one place.
 *
 * Put it on the modal **root** — the fixed, full-screen `.modal` wrapper that is
 * the sibling of `.modal-backdrop` — and it closes the modal when a click lands
 * outside the `.modal-content` dialog **or** on the corner ✕. The ✕ therefore
 * carries no `(click)` of its own: the directive owns it, so every modal closes
 * through exactly one path, and the footers no longer carry the redundant
 * `Close` / `Cancel` button that used to duplicate it.
 *
 * When the editor holds unsaved changes, set `[imsDirty]` and the user is asked
 * to confirm before the work is thrown away (see `snapshotForm()` /
 * `formChanged()` in `shared/confirm/unsaved-changes.ts`):
 *
 * ```html
 * <div class="modal show d-block" tabindex="-1" role="dialog"
 *      imsModalDismiss [imsDirty]="formDirty()" (dismiss)="closeForm()">
 *   ...
 *   <button type="button" class="btn-close" aria-label="Close"></button>
 * ```
 *
 * Closing after a successful save must call the component's close method
 * directly — `(dismiss)` never runs and so never asks.
 *
 * The press is tracked from `pointerdown` so dragging from inside the dialog and
 * releasing on the backdrop — or the other way round — does not dismiss.
 */
@Directive({
  selector: '[imsModalDismiss]',
  standalone: true,
})
export class ModalDismissDirective {
  /** Emitted when the modal should close (backdrop click or corner ✕). */
  @Output() readonly dismiss = new EventEmitter<void>();

  /** True when the editor holds unsaved changes — ask before discarding. */
  @Input() imsDirty = false;

  /** Prompt copy used when `imsDirty` is set. */
  @Input() imsDirtyTitle = 'Discard changes?';
  @Input() imsDirtyMessage = 'This editor has unsaved changes. Closing it will discard them.';
  @Input() imsDiscardLabel = 'Discard';
  @Input() imsKeepLabel = 'Keep editing';

  /** Whether the press that is still in flight started outside the dialog. */
  private pressedOutside = false;

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    private readonly confirm: ConfirmService,
  ) {}

  @HostListener('pointerdown', ['$event'])
  onPointerDown(ev: PointerEvent): void {
    this.pressedOutside = this.isOutsideDialog(ev.target);
  }

  @HostListener('click', ['$event'])
  onClick(ev: MouseEvent): void {
    const backdrop = this.pressedOutside && this.isOutsideDialog(ev.target);
    // The corner ✕ is deliberately handler-less in the template: it bubbles here.
    const closeButton = !!this.asElement(ev.target)?.closest('.btn-close');
    this.pressedOutside = false;
    if (backdrop || closeButton) this.requestDismiss();
  }

  /** Close now, or ask first when the editor has unsaved changes. */
  private requestDismiss(): void {
    if (!this.imsDirty) {
      this.dismiss.emit();
      return;
    }
    void this.confirm
      .ask({
        title: this.imsDirtyTitle,
        message: this.imsDirtyMessage,
        confirmLabel: this.imsDiscardLabel,
        cancelLabel: this.imsKeepLabel,
      })
      .then((discard) => {
        if (discard) this.dismiss.emit();
      });
  }

  /** True when the target sits on the wrapper itself or outside the dialog. */
  private isOutsideDialog(target: EventTarget | null): boolean {
    const dialog = this.host.nativeElement.querySelector('.modal-content');
    const el = this.asElement(target);
    return !dialog || !el || !dialog.contains(el);
  }

  private asElement(target: EventTarget | null): Element | null {
    return target instanceof Element ? target : null;
  }
}
