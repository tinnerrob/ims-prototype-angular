import { Directive, ElementRef, HostListener, Input, OnDestroy } from '@angular/core';

import { Tip, TipService } from './tip.service';

/**
 * Attaches a smart tooltip to an element.
 *
 * ```html
 * <div class="ts-block" [imsTip]="segmentTip(bar.ts)">…</div>
 * ```
 *
 * Drop the native `title` when you add this — otherwise the browser draws its
 * own tooltip alongside ours. Use `aria-label` if a screen-reader name matters
 * (the tip itself is `aria-hidden`, it is decoration over data already in the
 * DOM).
 *
 * The tip closes on pointer-leave, on focus/blur, on pointer-down (a drag is
 * starting), and whenever the page scrolls or resizes — the anchor rect is
 * captured when the tip opens, so a scrolled trigger would leave it floating.
 */
@Directive({
  selector: '[imsTip]',
  standalone: true,
})
export class TipDirective implements OnDestroy {
  /** Tip content; `null` renders nothing (so bindings can be conditional). */
  @Input('imsTip') tip: Tip | null = null;

  private open = false;

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    private readonly tips: TipService,
  ) {}

  @HostListener('pointerover', ['$event'])
  onOver(ev: PointerEvent): void {
    const target = this.asElement(ev.target);
    /* A nested control with its own native tooltip — a resize handle, the lane
       chevron, a grid button — owns the hover: close the host's tip so the two
       hints never stack. Moving back off the control re-opens it. */
    if (target && target !== this.host.nativeElement && target.closest('[title]')) {
      this.close();
      return;
    }
    this.onEnter();
  }

  @HostListener('pointerout', ['$event'])
  onOut(ev: PointerEvent): void {
    const to = this.asElement(ev.relatedTarget);
    if (to && this.host.nativeElement.contains(to)) return;
    this.close();
  }

  @HostListener('focusin')
  onEnter(): void {
    if (!this.tip?.title) return;
    this.open = true;
    this.tips.show(this.tip, this.host.nativeElement.getBoundingClientRect());
  }

  @HostListener('focusout')
  onLeave(): void {
    this.close();
  }

  /** A press starts a drag / click — the tip would sit over the target. */
  @HostListener('pointerdown')
  @HostListener('dragstart')
  onPress(): void {
    this.close();
  }

  @HostListener('window:scroll', ['$event'])
  @HostListener('window:resize')
  onViewportChanged(): void {
    this.close();
  }

  ngOnDestroy(): void {
    this.close();
  }

  /** The event target as an element (pointer events can target text nodes). */
  private asElement(target: EventTarget | null): HTMLElement | null {
    return target instanceof HTMLElement ? target : null;
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.tips.hide();
  }
}
