import { AfterViewInit, Directive, ElementRef, inject, Input, OnDestroy } from '@angular/core';

/** Where a table's page size is remembered — one key per table. */
const SIZE_PREFIX = 'ims.rows.';

/** The sizes the footer offers, in menu order. `0` is **All**. */
const SIZES: { label: string; value: number }[] = [
  { label: '10', value: 10 },
  { label: '25', value: 25 },
  { label: '50', value: 50 },
  { label: 'All', value: 0 },
];

/**
 * `<table class="table" imsPaged="assets">` — the record count, a page size and a pager,
 * in a footer under the table.
 *
 * A table opts in with **one attribute**. The directive slices the rows it finds into
 * pages (hiding the ones outside the current page with an inline `display`), builds the
 * footer under the table, and re-applies on every row change — Angular re-creates rows on
 * each filter, tab and store write, and a freshly rendered row is always shown.
 *
 * The footer is built with plain DOM rather than a component for the same reason the
 * columns gear was: it belongs in the page's own card, under a table Angular does not own,
 * and a page should not have to hold state or markup to get it. What it *reports* is its
 * own truth — how many rows this table is holding — so a filtered list counts what the
 * filter left, which is what a reader is looking at.
 *
 * The default is **All**, so nothing changes until a reader picks a size; the choice is
 * remembered per table (and per browser), like the prototype's own column profiles.
 */
@Directive({
  selector: 'table[imsPaged]',
  standalone: true,
})
export class TablePagerDirective implements AfterViewInit, OnDestroy {
  /** The table's identity — the key its page size is remembered under. */
  @Input({ required: true }) imsPaged = '';

  private readonly host = inject<ElementRef<HTMLTableElement>>(ElementRef);

  private foot?: HTMLElement;
  private pageEl?: HTMLElement;
  private prev?: HTMLButtonElement;
  private next?: HTMLButtonElement;
  private observer?: MutationObserver;

  /** Records per page; `0` shows every record. */
  private size = 0;
  private page = 1;

  ngAfterViewInit(): void {
    this.size = this.readSize();
    this.buildFoot();
    this.apply();
    this.observer = new MutationObserver(() => this.apply());
    this.observer.observe(this.host.nativeElement, { childList: true, subtree: true });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.foot?.remove();
  }

  /** The table's own rows. An empty-state row (`colspan`) is a message, not a record. */
  private rows(): HTMLElement[] {
    const rows = [...this.host.nativeElement.querySelectorAll(':scope > tbody > tr')] as HTMLElement[];
    return rows.filter(
      (row) => !(row.children.length === 1 && (row.children[0] as HTMLTableCellElement).colSpan > 1),
    );
  }

  /** Show the current page's rows and nothing else, then say so in the footer. */
  private apply(): void {
    const rows = this.rows();
    const total = rows.length;
    const pages = this.size ? Math.max(1, Math.ceil(total / this.size)) : 1;
    // A filter can leave fewer pages than the one on screen: come back to one that exists.
    this.page = Math.min(Math.max(1, this.page), pages);
    const from = this.size ? (this.page - 1) * this.size : 0;
    const to = this.size ? from + this.size : total;
    rows.forEach((row, i) => {
      const off = i < from || i >= to;
      if (off ? row.style.display !== 'none' : row.style.display) row.style.display = off ? 'none' : '';
    });
    this.paint(total, from, Math.min(to, total), pages);
  }

  private paint(total: number, from: number, to: number, pages: number): void {
    // The record range **is** the page indicator: "Records 11–16 of 16" says which records
    // you are looking at *and* that there is nothing after them, so the footer needs no
    // separate count on the left and no "Page n of n" beside the arrows.
    if (this.pageEl) {
      this.pageEl.textContent = total ? `Records ${from + 1}–${to} of ${total}` : 'No records';
    }
    if (this.prev) this.prev.disabled = this.page <= 1;
    if (this.next) this.next.disabled = this.page >= pages;
  }

  /** The footer, under the table's own scrolling box (so it does not scroll with it). */
  private buildFoot(): void {
    const host = this.host.nativeElement;
    const wrap = host.closest('.table-wrap') ?? host;
    const foot = document.createElement('div');
    foot.className = 'tbl-foot';
    foot.setAttribute('data-table', this.imsPaged);
    // The footer carries its own styles rather than adding to `styles.scss`: that sheet
    // ships in the *initial* bundle, which is at its budget, while this widget rides the
    // page's own lazy chunk. It is a widget, not a theme — the three global classes it
    // reuses (`btn-ims-outline`, `btn-sm2`, `form-select`) are the app's own.
    foot.style.cssText =
      'display:flex;align-items:center;justify-content:flex-end;gap:12px;flex-wrap:wrap;' +
      'padding:8px 2px 2px;margin-top:8px;border-top:1px solid var(--line)';
    foot.innerHTML =
      '<span class="tbl-foot-tools" style="display:flex;align-items:center;gap:10px">' +
      '<label class="tbl-foot-size" style="display:flex;align-items:center;gap:6px;margin:0;' +
      'font-size:12px;color:var(--slate-600)">Rows' +
      '<select class="form-select form-select-sm" aria-label="Records per page" ' +
      'style="width:auto;min-width:74px;padding:2px 26px 2px 10px">' +
      SIZES.map((s) => `<option value="${s.value}">${s.label}</option>`).join('') +
      '</select></label>' +
      '<span class="tbl-foot-pager" style="display:flex;align-items:center;gap:6px">' +
      '<button type="button" class="btn btn-ims-outline btn-sm2" title="Previous page">' +
      '<i class="bi bi-chevron-left"></i></button>' +
      '<span class="tbl-foot-page" style="min-width:132px;font-size:12px;text-align:center;' +
      'color:var(--slate-600);font-variant-numeric:tabular-nums;white-space:nowrap"></span>' +
      '<button type="button" class="btn btn-ims-outline btn-sm2" title="Next page">' +
      '<i class="bi bi-chevron-right"></i></button>' +
      '</span></span>';
    wrap.after(foot);
    this.foot = foot;

    this.pageEl = foot.querySelector('.tbl-foot-page') as HTMLElement;
    const buttons = [...foot.querySelectorAll('.tbl-foot-pager button')] as HTMLButtonElement[];
    this.prev = buttons[0];
    this.next = buttons[1];
    this.prev?.addEventListener('click', () => {
      this.page -= 1;
      this.apply();
    });
    this.next?.addEventListener('click', () => {
      this.page += 1;
      this.apply();
    });
    const select = foot.querySelector('select') as HTMLSelectElement;
    select.value = String(this.size);
    select.addEventListener('change', () => {
      this.size = Number(select.value) || 0;
      this.page = 1; // a new size starts at the top rather than halfway down a list
      this.writeSize();
      this.apply();
    });
  }

  /* ------------------------------ persistence ------------------------------ */

  private readSize(): number {
    try {
      const raw = localStorage.getItem(SIZE_PREFIX + this.imsPaged);
      const value = raw === null ? 0 : Number(raw) || 0;
      return SIZES.some((s) => s.value === value) ? value : 0;
    } catch {
      return 0;
    }
  }

  private writeSize(): void {
    try {
      localStorage.setItem(SIZE_PREFIX + this.imsPaged, String(this.size));
    } catch {
      /* storage unavailable (private mode) -> the size just does not stick */
    }
  }
}
