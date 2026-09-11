import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { Location, LocationType } from '../../core/models';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';
import { tip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';

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
  imports: [FormsModule, ModalDismissDirective, RecordViewComponent, TipDirective],
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
  /** Editor values as they were when it opened (drives the discard prompt). */
  private formSnap = '';

  /** Location-type editor (the `types` sub-table). */
  typeModalOpen = false;
  renameTypeFrom: string | null = null;
  formTypeName = '';
  formTypeActive = true;
  /** Type-editor values as they were when it opened. */
  private typeSnap = '';

  /** Read-only record viewer (opened by clicking a table row). */
  viewer: ViewModel | null = null;
  /** Record behind the open viewer, so the footer Edit can reopen the editor. */
  private viewing: { kind: 'location' | 'type'; id: string } | null = null;

  constructor(readonly data: DataService) {}

  /** Switch sub-table — closing any open editor so a stale modal can't linger. */
  selectTab(t: Tab): void {
    this.tab = t;
    this.closeForm();
    this.closeType();
    this.closeViewer();
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

  /**
   * Items stored *at* this node. This is the number the grid shows and the one
   * that blocks removal, so the cell and the guard can never disagree.
   */
  itemCount(id: string): number {
    return this.data.locationItemCount(id);
  }

  /** Items at this node or anywhere beneath it (a site's stock is in its bays). */
  subtreeItemCount(id: string): number {
    return this.data.locationSubtreeItemCount(id);
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
   * The store owns the walk (one tree walker for the whole app); this page only
   * asks for it with the cycle guard applied.
   */
  parentOptions(): { id: string; label: string }[] {
    return this.data.locationOptions(this.editingId);
  }

  /* --------------------------- location editor -------------------------- */

  openForm(loc?: Location): void {
    this.editingId = loc ? loc.id : null;
    this.form = loc
      ? { id: loc.id, name: loc.name, type: loc.type, parentId: loc.parentId ?? null, address: loc.address, phone: loc.phone, tz: loc.tz }
      : this.emptyForm();
    this.formSnap = snapshotForm(this.form);
    this.modalOpen = true;
  }

  /** Open the editor pre-set to create a child of `parent` (hierarchy shortcut). */
  openChild(parent: Location): void {
    this.openForm();
    this.form = { ...this.form, parentId: parent.id };
    // Pre-filling the parent is the starting point, not a user edit.
    this.formSnap = snapshotForm(this.form);
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

  /**
   * Remove a location. The store refuses while stock is stored at it (the grid
   * disables the action in that case), and re-parents the node's children so the
   * hierarchy stays intact.
   */
  remove(loc: Location): void {
    this.data.removeLocation(loc.id);
  }

  /** True when the location editor holds edits that Save has not written yet. */
  formDirty(): boolean {
    return formChanged(this.form, this.formSnap);
  }

  closeForm(): void {
    this.modalOpen = false;
    this.editingId = null;
    this.formSnap = '';
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
    this.typeSnap = snapshotForm(this.typeValues());
    this.typeModalOpen = true;
  }

  openTypeRename(t: LocationType): void {
    this.renameTypeFrom = t.name;
    this.formTypeName = t.name;
    this.formTypeActive = t.active !== false;
    this.typeSnap = snapshotForm(this.typeValues());
    this.typeModalOpen = true;
  }

  /** True when the type editor holds edits that Save has not written yet. */
  typeDirty(): boolean {
    return formChanged(this.typeValues(), this.typeSnap);
  }

  /** The type editor's values, as compared against the open-time snapshot. */
  private typeValues(): { name: string; active: boolean } {
    return { name: this.formTypeName, active: this.formTypeActive };
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
    this.typeSnap = '';
  }

  /* --------------------------- record viewer ---------------------------- */

  /**
   * Row click → read-only viewer. A click that lands on a row action (the
   * `+` / edit / remove icon buttons) is ignored so those keep working.
   */
  showLocationView(e: Event, loc: Location): void {
    if (isInteractiveTarget(e)) return;
    this.viewing = { kind: 'location', id: loc.id };
    this.viewer = {
      title: loc.name,
      subtitle: loc.id,
      icon: 'bi-diagram-3',
      sections: [
        {
          title: 'Hierarchy',
          fields: [
            { label: 'Location ID', value: loc.id, mono: true },
            { label: 'Type', value: loc.type || '—' },
            { label: 'Parent', value: this.parentName(loc) },
            { label: 'Children', value: String(this.childCount(loc.id)) },
          ],
        },
        {
          title: 'Address & Contact',
          fields: [
            { label: 'Address', value: loc.address || '—' },
            { label: 'Phone', value: loc.phone || '—' },
            { label: 'Time Zone', value: loc.tz },
          ],
        },
        {
          // What the hierarchy is *for*: a place holds stock. Both readings are
          // shown because a site holds none itself while its bays hold plenty.
          title: 'Contents',
          fields: [
            { label: 'Items Here', value: String(this.itemCount(loc.id)) },
            { label: 'Items In Subtree', value: String(this.subtreeItemCount(loc.id)) },
          ],
        },
      ],
    };
  }

  /** Location-type row click → read-only viewer. */
  showTypeView(e: Event, t: LocationType): void {
    if (isInteractiveTarget(e)) return;
    this.viewing = { kind: 'type', id: t.name };
    this.viewer = {
      title: t.name,
      subtitle: 'Location Type',
      icon: 'bi-tags',
      badge: t.active !== false ? 'Active' : 'Inactive',
      badgeClass: t.active !== false ? 'st-active' : 'st-out',
      sections: [
        {
          fields: [
            { label: 'Type Name', value: t.name },
            { label: 'Locations Using It', value: String(this.typeCount(t.name)) },
            { label: 'Available In Editor', value: t.active !== false ? 'Yes' : 'No' },
          ],
        },
      ],
    };
  }

  closeViewer(): void {
    this.viewer = null;
    this.viewing = null;
  }

  /** Viewer footer Edit → reopen this page's own editor for the shown record. */
  editFromViewer(): void {
    const v = this.viewing;
    this.closeViewer();
    if (!v) return;
    if (v.kind === 'type') {
      const t = this.typeRecords().find((x) => x.name === v.id);
      if (t) this.openTypeRename(t);
      return;
    }
    const loc = this.locations().find((l) => l.id === v.id);
    if (loc) this.openForm(loc);
  }

  /* ------------------------------ tooltips ------------------------------ */

  /** Location row: where it sits in the tree, what it holds, and how to reach it. */
  tipLocation(loc: Location): Tip {
    return tip(`${loc.id} - ${loc.name}`, [
      { label: 'Type', value: loc.type },
      { label: 'Parent', value: this.parentName(loc) },
      { label: 'Children', value: String(this.childCount(loc.id)) },
      { label: 'Items here', value: String(this.itemCount(loc.id)) },
      { label: 'Items in subtree', value: String(this.subtreeItemCount(loc.id)) },
      loc.address ? { label: 'Address', value: loc.address } : null,
      loc.phone ? { label: 'Phone', value: loc.phone } : null,
      loc.tz ? { label: 'Time zone', value: loc.tz } : null,
    ]);
  }

  /** Location-type row: what it is used by. */
  tipLocationType(t: LocationType): Tip {
    return tip(t.name, [{ label: 'Locations', value: String(this.typeCount(t.name)) }], {
      badge: t.active === false ? 'Inactive' : 'Active',
      badgeClass: t.active === false ? 'st-out' : 'st-active',
    });
  }
}
