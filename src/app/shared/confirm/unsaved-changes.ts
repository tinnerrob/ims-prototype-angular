/**
 * Change detection for the modal editors, so a close can ask before throwing
 * work away (`ModalDismissDirective` → `[imsDirty]`).
 *
 * Take a snapshot when the editor opens and compare it on close:
 *
 *     private formSnap = '';
 *
 *     openForm(): void {
 *       this.form = ...;
 *       this.formSnap = snapshotForm(this.form);
 *       this.modalOpen = true;
 *     }
 *
 *     formDirty(): boolean { return formChanged(this.form, this.formSnap); }
 */

/** Stable string for a form model — stored when the editor opens. */
export function snapshotForm(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** True when the model no longer matches the snapshot taken when it opened. */
export function formChanged(value: unknown, snapshot: string): boolean {
  return snapshotForm(value) !== snapshot;
}
