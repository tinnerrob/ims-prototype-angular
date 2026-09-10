import { ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService, dISO, hmMin, minHM, snap15 } from '../../core/data.service';
import { Item, Timesheet, TIMESHEET_KIND, TimesheetTarget } from '../../core/models';

const DAY_MS = 86400000;
const DAY_A = 0;
const DAY_B = 1440;
/** Row band height (px) — matches the prototype's `ROWH`. */
const ROWH = 54;
/** Vertical breathing room inside a row band. */
const ROWM = Math.max(4, Math.round(ROWH * 0.1));
/** Right gutter column holding the per-row punch button. */
const GUT = 40;

type LabView = 'day' | 'week' | 'month';

interface Bar {
  ts: Timesheet;
  live: boolean;
  left: number;
  width: number;
  top: number;
  height: number;
}

interface Lane {
  emp: Item;
  bars: Bar[];
  trackHeight: number;
  logged: number;
  open: Timesheet | null;
}

interface DragState {
  ts: Timesheet;
  mode: 'move' | 'l' | 'r';
  track: HTMLElement;
  startX: number;
  origIn: number;
  origOut: number;
  origDate: string;
  cols: number;
  isDay: boolean;
  moved: boolean;
}

/**
 * Labor & Timesheets (module) — port of the prototype's labor board
 * (js/pages/timesheet.js): the scheduler-style 3-pane page with employee rows,
 * coloured clock-segment bars (drag to move / resize, click to edit), the
 * drag-to-clock-in task pool, the punch modal (incl. lunch) and the
 * time-allocation summary.
 */
@Component({
  selector: 'ims-timesheet',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './timesheet.component.html',
  styleUrl: './timesheet.component.scss',
})
export class TimesheetComponent implements OnDestroy {
  readonly kind = TIMESHEET_KIND;
  readonly kinds = Object.keys(TIMESHEET_KIND) as TimesheetTarget[];
  readonly rowH = ROWH;
  readonly gutter = GUT;

  view: LabView = 'week';
  anchor = new Date();
  selectedEmp = 'EMP-001';

  /** Chip currently being dragged from the left pane. */
  dragging: { type: TimesheetTarget; id: string | null } | null = null;

  /** Segment editor modal. */
  editOpen = false;
  editId: string | null = null;
  editDate = '';
  editIn = '';
  editOut = '';
  editTarget = 'order|';

  /** Punch (clock in/out) modal. */
  punchOpen = false;
  punchEmpId = '';
  punchDate = '';
  punchTime = '';

  private drag: DragState | null = null;
  /** Set when a drag actually moved, so the trailing `click` doesn't open the editor. */
  private justDragged = false;

  constructor(
    readonly data: DataService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnDestroy(): void {
    this.drag = null;
  }

  /* --------------------------- calendar window -------------------------- */

  isDay(): boolean {
    return this.view === 'day';
  }

  days(): Date[] {
    const a = this.anchor;
    if (this.view === 'month') {
      const n = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
      const out: Date[] = [];
      for (let i = 1; i <= n; i++) out.push(new Date(a.getFullYear(), a.getMonth(), i));
      return out;
    }
    if (this.view === 'week') {
      const w = new Date(a);
      w.setDate(w.getDate() - ((w.getDay() + 6) % 7));
      w.setHours(0, 0, 0, 0);
      const out: Date[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(w);
        d.setDate(d.getDate() + i);
        out.push(d);
      }
      return out;
    }
    const d = new Date(a);
    d.setHours(0, 0, 0, 0);
    return [d];
  }

  dayKeys(): string[] {
    return this.days().map((d) => dISO(d));
  }

  colCount(): number {
    return this.isDay() ? DAY_B / 60 : this.days().length;
  }

  /** Sticky label gutter + one column per hour/day + the punch gutter. */
  gridTemplate(): string {
    if (this.isDay()) return `120px repeat(${DAY_B / 60},1fr) ${GUT}px`;
    const min = this.view === 'month' ? 34 : 88;
    return `120px repeat(${this.colCount()},minmax(${min}px,1fr)) ${GUT}px`;
  }

  /** Minimum pixel width so the grid can scroll horizontally. */
  minWidth(): number {
    if (this.isDay()) return 120 + GUT + (DAY_B / 60) * 44;
    return 120 + GUT + this.colCount() * (this.view === 'month' ? 40 : 92);
  }

  hourLabels(): string[] {
    const out: string[] = [];
    for (let h = DAY_A / 60; h < DAY_B / 60; h++) {
      const hh = h % 12 === 0 ? 12 : h % 12;
      out.push(`${hh}${h < 12 ? 'a' : 'p'}`);
    }
    return out;
  }

  isToday(d: Date): boolean {
    return dISO(d) === dISO(new Date());
  }

  rangeLabel(): string {
    const days = this.days();
    if (this.view === 'month') {
      return days[0].toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if (this.view === 'week') {
      return 'Week of ' + days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return days[0].toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  nav(delta: number): void {
    const a = new Date(this.anchor);
    if (this.view === 'month') a.setMonth(a.getMonth() + delta);
    else if (this.view === 'week') a.setDate(a.getDate() + delta * 7);
    else a.setDate(a.getDate() + delta);
    this.anchor = a;
  }

  setView(v: LabView): void {
    this.view = v;
    const a = new Date(this.anchor);
    if (v === 'month') this.anchor = new Date(a.getFullYear(), a.getMonth(), 1);
    else if (v === 'week') a.setDate(a.getDate() - ((a.getDay() + 6) % 7));
    if (v === 'week') this.anchor = a;
  }

  /* -------------------------------- lanes ------------------------------- */

  employees(): Item[] {
    return this.data.listItems('labor').slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** Employee rows: staffed with positioned clock-segment bars. */
  lanes(): Lane[] {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return this.employees().map((emp) => {
      const geo = this.isDay() ? this.laneDay(emp.id, nowMin) : this.laneDays(emp.id);
      return {
        emp,
        bars: geo.items,
        trackHeight: geo.laneRows * ROWH,
        logged: this.loggedHours(emp.id),
        open: this.data.openSegment(emp.id) ?? null,
      };
    });
  }

  /** Completed hours logged by an employee in the visible window. */
  private loggedHours(empId: string): number {
    return this.data
      .timesheetsFor(empId, this.dayKeys())
      .reduce((s, t) => s + this.data.segmentHours(t), 0);
  }

  /** Week/month: one stacked slot per segment within each day column. */
  private laneDays(empId: string): { items: Bar[]; laneRows: number } {
    const days = this.days();
    const cols = days.length;
    const cw = 100 / cols;
    const colIdx = new Map<string, number>();
    days.forEach((d, i) => colIdx.set(dISO(d), i));
    const inset = cols > 26 ? 0.6 : 2.2;

    const byDay = new Map<string, Timesheet[]>();
    for (const t of this.data.timesheetsFor(empId, this.dayKeys())) {
      const arr = byDay.get(t.date) ?? [];
      arr.push(t);
      byDay.set(t.date, arr);
    }

    let laneRows = 1;
    const items: Bar[] = [];
    for (const [key, arr] of byDay) {
      const sorted = arr.slice(0, 6).sort((x, y) => hmMin(x.clockIn) - hmMin(y.clockIn));
      laneRows = Math.max(laneRows, sorted.length);
      const ci = colIdx.get(key) ?? 0;
      sorted.forEach((ts, slot) => {
        items.push({
          ts,
          live: !ts.clockOut,
          left: ci * cw + inset / 2,
          width: cw - inset,
          top: slot * ROWH + ROWM,
          height: ROWH - 2 * ROWM,
        });
      });
    }
    return { items, laneRows };
  }

  /** Day view: time-of-day bars across a 24-hour axis; overlaps stack. */
  private laneDay(empId: string, nowMin: number): { items: Bar[]; laneRows: number } {
    const span = DAY_B - DAY_A;
    const segs = this.data
      .timesheetsFor(empId, this.dayKeys())
      .slice()
      .sort((a, b) => hmMin(a.clockIn) - hmMin(b.clockIn));
    const laneEnds: number[] = [];
    const placed: { ts: Timesheet; s: number; e: number; slot: number }[] = [];
    for (const ts of segs) {
      let s = hmMin(ts.clockIn);
      let e = ts.clockOut ? hmMin(ts.clockOut) : nowMin;
      if (e <= s) e = s + 30;
      s = Math.max(DAY_A, s);
      e = Math.min(DAY_B, Math.max(s, e));
      let slot = laneEnds.findIndex((end) => s >= end);
      if (slot < 0) {
        slot = laneEnds.length;
        laneEnds.push(e);
      } else {
        laneEnds[slot] = e;
      }
      placed.push({ ts, s, e, slot });
    }
    return {
      laneRows: Math.max(1, laneEnds.length),
      items: placed.map((p) => ({
        ts: p.ts,
        live: !p.ts.clockOut,
        left: ((p.s - DAY_A) / span) * 100,
        width: Math.max(1.2, ((p.e - p.s) / span) * 100),
        top: p.slot * ROWH + ROWM,
        height: ROWH - 2 * ROWM,
      })),
    };
  }

  /** Hover tooltip for a bar (prototype `tsTip`). */
  tip(ts: Timesheet): string {
    const e = this.data.getItem('labor', ts.empId);
    const end = ts.clockOut ?? 'now';
    const hrs = ts.clockOut ? `${this.data.segmentHours(ts)} hr` : 'running';
    return `${ts.date}  ${ts.clockIn}–${end}  ${hrs}\n${this.data.segmentLabel(ts)}\n${e?.name ?? ts.empId} · ${e?.role ?? ''}`;
  }

  segClass(ts: Timesheet): string {
    return TIMESHEET_KIND[ts.targetType].cls;
  }

  segShort(ts: Timesheet): string {
    return this.data.segmentShort(ts);
  }

  /** Now-marker position in Day view (%). */
  nowLeft(): number {
    const n = new Date();
    return ((n.getHours() * 60 + n.getMinutes() - DAY_A) / (DAY_B - DAY_A)) * 100;
  }

  /* ---------------------------- left pane ------------------------------- */

  activeOrders() {
    return this.data
      .activeOrders()
      .slice()
      .sort((a, b) => (a.orderId < b.orderId ? -1 : 1));
  }

  openWorkOrders() {
    return this.data.listWorkOrders().filter((w) => w.status !== 'Completed');
  }

  /** Quick-task targets (shop / overhead / idle). */
  quickTasks(): TimesheetTarget[] {
    return ['shop', 'overhead', 'idle'];
  }

  startChip(e: DragEvent, type: TimesheetTarget, id: string | null): void {
    this.dragging = { type, id };
    e.dataTransfer?.setData('text/plain', JSON.stringify({ type, id }));
    e.dataTransfer?.setData('application/x-task', `${type}|${id ?? ''}`);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  endChip(): void {
    this.dragging = null;
  }

  onRowDrop(e: DragEvent, empId: string): void {
    e.preventDefault();
    this.dragging = null;
    const raw = e.dataTransfer?.getData('text/plain') || e.dataTransfer?.getData('application/x-task') || '';
    let type: TimesheetTarget | null = null;
    let id: string | null = null;
    try {
      const parsed = JSON.parse(raw);
      type = parsed.type ?? null;
      id = parsed.id ?? null;
    } catch {
      const [t, i] = raw.split('|');
      type = (t as TimesheetTarget) || null;
      id = i || null;
    }
    if (!type) return;
    this.data.clockInto(empId, type, id);
    this.selectedEmp = empId;
    this.cdr.detectChanges();
  }


  /* ------------------------- drag: move + resize ------------------------ */

  /** Begin a move drag on a bar body. */
  beginMove(e: MouseEvent, ts: Timesheet): void {
    this.beginDrag(e, ts, 'move');
  }

  /** Begin a resize drag from a bar edge grip (Day view). */
  beginResize(e: MouseEvent, ts: Timesheet, edge: 'l' | 'r'): void {
    e.preventDefault();
    e.stopPropagation();
    this.beginDrag(e, ts, edge);
  }

  private beginDrag(e: MouseEvent, ts: Timesheet, mode: 'move' | 'l' | 'r'): void {
    if (ts.clockOut == null) return; // running segments are not draggable
    const track = (e.target as Element).closest('.lab-track') as HTMLElement | null;
    if (!track) return;
    const d: DragState = {
      ts,
      mode,
      track,
      startX: e.clientX,
      origIn: hmMin(ts.clockIn),
      origOut: hmMin(ts.clockOut),
      origDate: ts.date,
      cols: this.colCount(),
      isDay: this.isDay(),
      moved: false,
    };
    this.drag = d;
    const move = (ev: MouseEvent) => this.onDragMove(ev);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const moved = this.drag?.moved;
      this.drag = null;
      if (moved) {
        // Suppress the click that follows a real drag (prototype `labJustDrag`).
        this.justDragged = true;
        this.cdr.detectChanges();
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  private onDragMove(ev: MouseEvent): void {
    const d = this.drag;
    if (!d) return;
    const rect = d.track.getBoundingClientRect();

    if (d.isDay) {
      // Time axis: 15-minute snapping.
      const span = DAY_B - DAY_A;
      const mins = snap15(DAY_A + ((ev.clientX - rect.left) / (rect.width || 1)) * span);
      if (d.mode === 'move') {
        const delta = Math.round((((ev.clientX - d.startX) / (rect.width || 1)) * span) / 15) * 15;
        let s = d.origIn + delta;
        let e = d.origOut + delta;
        if (s < DAY_A) { e += DAY_A - s; s = DAY_A; }
        if (e > DAY_B) { s -= e - DAY_B; e = DAY_B; }
        this.data.updateTimesheet(d.ts.id, {
          clockIn: minHM(s),
          clockOut: minHM(e),
          hours: Math.round(((e - s) / 60) * 100) / 100,
        });
      } else if (d.mode === 'l') {
        const s = Math.max(DAY_A, Math.min(d.origOut - 15, mins));
        this.data.updateTimesheet(d.ts.id, {
          clockIn: minHM(s),
          hours: Math.round(((d.origOut - s) / 60) * 100) / 100,
        });
      } else {
        const e = Math.min(DAY_B, Math.max(d.origIn + 15, mins));
        this.data.updateTimesheet(d.ts.id, {
          clockOut: minHM(e),
          hours: Math.round(((e - d.origIn) / 60) * 100) / 100,
        });
      }
    } else {
      // Calendar axis: whole-day snapping.
      const cols = d.cols || 1;
      const delta = Math.round((ev.clientX - d.startX) / ((rect.width || 1) / cols));
      if (delta !== 0) {
        const base = this.data.parseDT(d.origDate);
        base.setDate(base.getDate() + delta);
        this.data.updateTimesheet(d.ts.id, { date: dISO(base) });
      }
    }
    d.moved = true;
    this.cdr.detectChanges();
  }


  /* --------------------------- segment editor --------------------------- */

  /** Bar click: opens the editor unless the click ended a drag. */
  onBarClick(ts: Timesheet): void {
    if (this.justDragged) {
      this.justDragged = false;
      return;
    }
    this.openEdit(ts);
  }

  openEdit(ts: Timesheet): void {
    this.editId = ts.id;
    this.editDate = ts.date;
    this.editIn = ts.clockIn;
    this.editOut = ts.clockOut ?? '';
    this.editTarget = `${ts.targetType}|${ts.targetId ?? ''}`;
    this.editOpen = true;
  }

  saveEdit(): void {
    const ts = this.editId ? this.data.getTimesheet(this.editId) : undefined;
    if (!ts) return;
    const inMin = hmMin(this.editIn);
    const outMin = this.editOut ? hmMin(this.editOut) : null;
    if (outMin != null && outMin <= inMin) return; // clock out must follow clock in
    const [tt, tid] = this.editTarget.split('|');
    this.data.updateTimesheet(ts.id, {
      date: this.editDate,
      clockIn: minHM(inMin),
      clockOut: outMin != null ? minHM(outMin) : null,
      hours: outMin != null ? Math.round(((outMin - inMin) / 60) * 100) / 100 : null,
      targetType: tt as TimesheetTarget,
      targetId: tt === 'order' || tt === 'workorder' ? tid || null : null,
    });
    this.closeEdit();
  }

  /** Close the running segment at the current wall-clock minute. */
  clockOutNow(): void {
    const ts = this.editId ? this.data.getTimesheet(this.editId) : undefined;
    if (!ts) return;
    this.data.punchOut(ts.empId);
    this.closeEdit();
  }

  deleteEdit(): void {
    if (this.editId) this.data.removeTimesheet(this.editId);
    this.closeEdit();
  }

  closeEdit(): void {
    this.editOpen = false;
    this.editId = null;
  }

  editingLive(): boolean {
    const ts = this.editId ? this.data.getTimesheet(this.editId) : undefined;
    return !!ts && !ts.clockOut;
  }

  editEmployee(): string {
    const ts = this.editId ? this.data.getTimesheet(this.editId) : undefined;
    if (!ts) return '';
    const e = this.data.getItem('labor', ts.empId);
    return e ? `${e.name} · ${e.id} · ${ts.id}` : ts.empId;
  }

  /** Target options for the editor select, grouped like the prototype. */
  targetOptions(): { group: string; value: string; label: string }[] {
    const out: { group: string; value: string; label: string }[] = [];
    for (const o of this.activeOrders()) {
      out.push({ group: 'Job', value: `order|${o.orderId}`, label: `${o.orderId} · ${o.projectName}` });
    }
    for (const w of this.openWorkOrders()) {
      out.push({ group: 'Work order', value: `workorder|${w.id}`, label: `${w.id} · ${w.itemId}` });
    }
    out.push({ group: 'Other', value: 'shop|', label: 'Shop' });
    out.push({ group: 'Other', value: 'overhead|', label: 'Overhead' });
    out.push({ group: 'Other', value: 'idle|', label: 'Idle' });
    out.push({ group: 'Other', value: 'lunch|', label: 'Lunch' });
    return out;
  }

  targetGroups(): string[] {
    return ['Job', 'Work order', 'Other'];
  }

  optionsIn(group: string): { value: string; label: string }[] {
    return this.targetOptions().filter((o) => o.group === group);
  }


  /* ------------------------------- punch -------------------------------- */

  openPunch(empId: string): void {
    const now = new Date();
    this.punchEmpId = empId;
    this.punchDate = dISO(now);
    this.punchTime = minHM(now.getHours() * 60 + now.getMinutes());
    this.punchOpen = true;
  }

  punchEmployee(): Item | undefined {
    return this.data.getItem('labor', this.punchEmpId);
  }

  punchOpenSegment(): Timesheet | null {
    return this.data.openSegment(this.punchEmpId) ?? null;
  }

  punchOnLunch(): boolean {
    return this.punchOpenSegment()?.targetType === 'lunch';
  }

  /** Pick a target: close the current segment, start a new one at the keyed time. */
  punchTo(type: TimesheetTarget, id: string | null): void {
    this.data.punchIn(this.punchEmpId, type, id, hmMin(this.punchTime), this.punchDate);
    this.selectedEmp = this.punchEmpId;
    this.punchOpen = false;
  }

  punchClockOut(): void {
    this.data.closeOpen(this.punchEmpId, hmMin(this.punchTime));
    this.punchOpen = false;
  }

  punchLunchOut(): void {
    this.punchTo('lunch', null);
  }

  punchLunchIn(): void {
    this.data.closeOpen(this.punchEmpId, hmMin(this.punchTime));
    this.punchOpen = false;
  }

  /* ------------------------------ summary ------------------------------- */

  /** Hours per target kind across the visible window (summary bars). */
  summaryByKind(): { kind: TimesheetTarget; hours: number; pct: number }[] {
    const segs = this.data.timesheetsIn(this.dayKeys());
    const total = segs.reduce((s, t) => s + this.data.segmentHours(t), 0) || 1;
    return this.kinds.map((k) => {
      const hours = segs
        .filter((t) => t.targetType === k)
        .reduce((s, t) => s + this.data.segmentHours(t), 0);
      return { kind: k, hours, pct: Math.round((hours / total) * 100) };
    });
  }

  summaryTotals(): { hours: number; cost: number; bill: number } {
    const segs = this.data.timesheetsIn(this.dayKeys());
    return {
      hours: Math.round(segs.reduce((s, t) => s + this.data.segmentHours(t), 0) * 100) / 100,
      cost: Math.round(segs.reduce((s, t) => s + this.data.segmentCost(t), 0) * 100) / 100,
      bill: Math.round(segs.reduce((s, t) => s + this.data.segmentBill(t), 0) * 100) / 100,
    };
  }

  /** Bar width (%) for a summary row. */
  rounded(n: number): number {
    return Math.round(n * 100) / 100;
  }
}

