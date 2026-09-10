import { Directive, ElementRef, EventEmitter, HostListener, Output } from '@angular/core';

/**
 * Click-outside-to-dismiss for the hand-rolled modals.
 *
 * Put it on the modal **root** — the fixed, full-screen `.modal` wrapper that is
 * the sibling of `.modal-backdrop` — and it fires as soon as a click lands
 * outside the `.modal-content` dialog. Together with the corner ✕ (and the
 * footer's primary/cancel actions) that is the only way out of a modal: the
 * footers no longer carry a redundant `Close` button.
 *
 * The press is tracked from `pointerdown` so dragging from inside the dialog and
 * releasing on the backdrop — or the other way round — does not dismiss.
 *
 * ```html
 * <div class="modal show d-block" tabindex="-1" role="dialog"
 *      imsModalDismiss (dismiss)="closeForm()">
 * ```
 */
@Directive({
  selector: '[imsModalDismiss]',
  standalone: true,
})
export class ModalDismissDirective {
  /** Emitted when the press started and ended outside the dialog. */
  @Output() readonly dismiss = new EventEmitter<void>();

  /** Whether the press that is still in flight started outside the dialog. */
  private pressedOutside = false;

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  @HostListener('pointerdown', ['$event'])
  onPointerDown(ev: PointerEvent): void {
    this.pressedOutside = this.isOutsideDialog(ev.target);
  }

  @HostListener('click', ['$event'])
  onClick(ev: MouseEvent): void {
    const dismiss = this.pressedOutside && this.isOutsideDialog(ev.target);
    this.pressedOutside = false;
    if (dismiss) this.dismiss.emit();
  }

  /** True when the target sits on the wrapper itself or outside the dialog. */
  private isOutsideDialog(target: EventTarget | null): boolean {
    const dialog = this.host.nativeElement.querySelector('.modal-content');
    const el = target as Element | null;
    return !dialog || !el || !dialog.contains(el);
  }
}
