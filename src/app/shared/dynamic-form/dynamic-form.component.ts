import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FormError } from '../../core/forms.service';
import { FormField, FormSchema } from '../../core/models';

/** A schema's fields grouped under their `group` heading, in declaration order. */
interface FieldGroup {
  name: string;
  fields: FormField[];
}

/**
 * `<ims-dynamic-form>` (B2, see `docs/PLAN-B.md`) — renders a `FormSchema` over
 * an `attributes` object.
 *
 * The form builder's view half: it renders *any* schema — the Assets editor, a
 * receiving line and an inspection checklist all use it (B6/B7) — so a tenant's
 * custom fields appear without a component knowing what they mean. It writes into
 * the `values` object it is given (a record's `attributes`), and the parent is
 * responsible for `coerce()` / `validate()` on save (so the stored blob only ever
 * carries declared keys). `showIf` hides a field whose condition does not hold.
 */
@Component({
  selector: 'ims-dynamic-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './dynamic-form.component.html',
  styleUrl: './dynamic-form.component.scss',
})
export class DynamicFormComponent {
  /** The schema to render — its `fields` are the dynamic section. */
  @Input() schema: FormSchema | null = null;
  /** The values (a record's `attributes`); mutated in place as the user types. */
  @Input() values: Record<string, unknown> | null = null;
  /** Validation errors to show beneath their fields. */
  @Input() errors: FormError[] = [];
  /** Render read-only (no input is editable). */
  @Input() readOnly = false;
  /** Emitted on every edit, so a parent may react without a `[(values)]` binding. */
  @Output() valuesChange = new EventEmitter<Record<string, unknown>>();

  /** The value a field currently shows. */
  val(f: FormField): unknown {
    return this.values ? this.values[f.key] : undefined;
  }

  /** Write a field's value into the shared object (an empty value clears the key). */
  set(f: FormField, v: unknown): void {
    if (!this.values) return;
    if (v === undefined || v === null || v === '') delete this.values[f.key];
    else this.values[f.key] = v;
    this.valuesChange.emit(this.values);
  }

  /** The message under a field, when it failed validation. */
  errorFor(key: string): string | undefined {
    return this.errors.find((e) => e.key === key)?.message;
  }

  hasFields(): boolean {
    return (this.schema?.fields.length ?? 0) > 0;
  }

  /** The schema's visible fields, grouped by `group` in declaration order. */
  groups(): FieldGroup[] {
    const out: FieldGroup[] = [];
    for (const f of this.visibleFields()) {
      const name = f.group ?? '';
      let g = out.find((x) => x.name === name);
      if (!g) {
        g = { name, fields: [] };
        out.push(g);
      }
      g.fields.push(f);
    }
    return out;
  }

  /** Fields whose `showIf` condition currently holds (no `showIf` = always shown). */
  private visibleFields(): FormField[] {
    return (this.schema?.fields ?? []).filter(
      (f) => !f.showIf || (this.values ? this.values[f.showIf.key] === f.showIf.equals : false),
    );
  }
}
