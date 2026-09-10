import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { Location, LocationType } from '../../core/models';

/** A location plus its depth in the ragged hierarchy (drives table indentation). */
interface LocationRow {
  loc: Location;
  depth: number;
}

/** Which of the page's two sub-tables is showing (the tab strip at the top). */
type Tab = 'locations' | 'types';

/**
 * Data-free blank editor form. Class field initializers run *before* the
 * constructor assigns `data`, so the id default is applied by `emptyForm()`.
 */
const BLANK_LOCATION_FORM: Omit<Location, 'id'> & { id: string } = {
  id: '',
  name: '',
  type: '',
  parentId: null,
  address: '',
  phone: '',
  tz: 'America/New_York',
};

/**
 * Locations (Administration → Locations) — the location hierarchy and the
 * location-type vocabulary as two sub-tables behind a tab strip (the same
 * pattern as Categories), so both live on one page.
 *
 * Port of the prototype's `renderBranches` (js/pages/branches.js), extended to
 * a *ragged hierarchy*: each location has one optional parent and any number
 * of children, and any node may itself be a parent at any depth (an
 * adjacency-list / self-referencing `parent_id`).
 */
@Component({
  selector: 'ims-locations',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './locations.component.html',
  styleUrl: './locations.component.scss',
})
export class LocationsComponent {
  /** Which sub-table the page is showing. */
  tab: Tab = 'locations';

  search = '';

  /** Location editor. */
  modalOpen = false;
  editingId: string | null = null;
  form = { ...BLANK_LOCATION_FORM };

  /** Location-type editor (the `types` sub-table). */
  typeModalOpen = false;
  renameTypeFrom: string | null = null;
  formTypeName = '';
  formTypeActive = true;

  constructor(readonly data: DataService) {}

  /** Switch sub-table — closing any open editor so a stale modal can't linger. */
  selectTab(t: Tab): void {
    this.tab = t;
    this.closeForm();
    this.closeType();
  }

  /* ------------------------------- queries ------------------------------ */

  locations(): Location[] {
    return this.data.listLocations();
  }

  /**
   * The hierarchy flattened depth-first with a `depth` per row — the table
   * renders parents above their children, indented by depth.
   */
  private treeRows(): LocationRow[] {
    const out: LocationRow[] = [];
    const visited = new Set<string>();
    const walk = (parentId: string | null, depth: number): void => {
      for (const loc of this.data.locationChildren(parentId)) {
        if (visited.has(loc.id)) continue; // defensive: never loop on a cycle
        visited.add(loc.id);
        out.push({ loc, depth });
        walk(loc.id, depth + 1);
      }
    };
    walk(null, 0);
    // Defensive: surface a node whose parent row is missing (orphan) so it is
    // still visible/editable rather than silently dropped from the table.
    for (const loc of this.data.listLocations()) {
      if (!visited.has(loc.id)) {
        visited.add(loc.id);
        out.push({ loc, depth: 0 });
      }
    }
    return out;
  }

  /** Tree rows filtered by the search box (indentation/depth is preserved). */
  rows(): LocationRow[] {
    const all = this.treeRows();
    const q = this.search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(({ loc }) =>
      [loc.id, loc.name, loc.type, loc.address, loc.phone].join(' ').toLowerCase().includes(q),
    );
  }

  /** Left padding (px) that indents a row under its parent. */
  indent(row: LocationRow): number {
    return 8 + row.depth * 18;
  }

  parentName(loc: Location): string {
    return loc.parentId ? this.data.getLocation(loc.parentId)?.name ?? '(missing)' : '— Top level —';
  }

  childCount(id: string): number {
    return this.data.locationChildCount(id);
  }

  /** Active location types for the editor (keeps a now-inactive current value). */
  typeOptions(): string[] {
    const active = this.data.activeLocationTypes();
    const current = this.form.type;
    return current && !active.includes(current) ? [current, ...active] : active;
  }

  /**
   * Parent candidates for the editor: every location except the one being
   * edited and its descendants, so the ragged hierarchy can't be made cyclic.
   */
  parentOptions(): { id: string; label: string }[] {
    return this.treeRows()
      .filter(({ loc }) => !this.editingId || !this.data.isLocationAncestor(loc.id, this.editingId))
      .map(({ loc, depth }) => ({ id: loc.id, label: '— '.repeat(depth) + `${loc.name} (${loc.id})` }));
  }

  /* --------------------------- location editor -------------------------- */

  openForm(loc?: Location): void {
    this.editingId = loc ? loc.id : null;
    this.form = loc
      ? { id: loc.id, name: loc.name, type: loc.type, parentId: loc.parentId ?? null, address: loc.address, phone: loc.phone, tz: loc.tz }
      : this.emptyForm();
    this.modalOpen = true;
  }

  /** Open the editor pre-set to create a child of `parent` (hierarchy shortcut). */
  openChild(parent: Location): void {
    this.openForm();
    this.form = { ...this.form, parentId: parent.id };
  }

  save(): void {
    const f = this.form;
    if (!f.id.trim() || !f.name.trim()) return;
    const patch: Omit<Location, 'id'> = {
      name: f.name.trim(),
      type: f.type || this.data.activeLocationTypes()[0] || '',
      parentId: f.parentId || null,
      address: f.address,
      phone: f.phone,
      tz: f.tz,
    };
    if (this.editingId) this.data.updateLocation(this.editingId, patch);
    else this.data.createLocation({ ...patch, id: f.id.trim() });
    this.closeForm();
  }

  remove(loc: Location): void {
    this.data.removeLocation(loc.id);
  }

  closeForm(): void {
    this.modalOpen = false;
    this.editingId = null;
  }

  private emptyForm() {
    return { ...BLANK_LOCATION_FORM, id: this.data.previewLocationId() };
  }

  /* ---------------------------- location types --------------------------- */

  typeRecords(): LocationType[] {
    return this.data.locationTypeRecords();
  }

  /** How many locations use a type (blocks removal while > 0). */
  typeCount(name: string): number {
    return this.data.locationTypeCount(name);
  }

  openTypeAdd(): void {
    this.renameTypeFrom = null;
    this.formTypeName = '';
    this.formTypeActive = true;
    this.typeModalOpen = true;
  }

  openTypeRename(t: LocationType): void {
    this.renameTypeFrom = t.name;
    this.formTypeName = t.name;
    this.formTypeActive = t.active !== false;
    this.typeModalOpen = true;
  }

  saveType(): void {
    const name = this.formTypeName.trim();
    if (!name) return;
    if (this.renameTypeFrom) this.data.renameLocationType(this.renameTypeFrom, name, this.formTypeActive);
    else this.data.addLocationType(name, this.formTypeActive);
    this.closeType();
  }

  removeType(t: LocationType): void {
    this.data.removeLocationType(t.name);
  }

  closeType(): void {
    this.typeModalOpen = false;
    this.renameTypeFrom = null;
    this.formTypeName = '';
    this.formTypeActive = true;
  }
}
