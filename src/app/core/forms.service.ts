import { Injectable } from '@angular/core';

import { DataService } from './data.service';
import { CatalogType, Category, FormField, FormSchema, FormScope } from './models';

/** One thing wrong with a record's `attributes`, as `<ims-dynamic-form>` shows it. */
export interface FormError {
  key: string;
  message: string;
}

/**
 * IMS — FormsService (B2, see `docs/PLAN-B.md`).
 *
 * The read/validate side of the form builder. A schema is a tenant row (the
 * store owns it); this service resolves which schema an editor should use for a
 * scope + type, turns a record's `attributes` into editor values and back, and
 * validates them. The rule it enforces is the phase's one rule: **the schema is
 * the contract, the `attributes` jsonb is the payload** — `coerce()` drops any
 * key the schema does not declare, and a fact that has to be *queried* is promoted
 * to a real column rather than filtered out of the blob.
 */
@Injectable({ providedIn: 'root' })
export class FormsService {
  constructor(private readonly data: DataService) {}

  /**
   * Active schemas for a scope + type. An exact `type` match sorts before a
   * wildcard (`'*'`), so the most specific schema is `[0]`.
   */
  schemasFor(scope: FormScope, type?: CatalogType): FormSchema[] {
    return this.data
      .listFormSchemas(scope, type)
      .filter((s) => s.active)
      .sort((a, b) => (a.type === type ? 0 : 1) - (b.type === type ? 0 : 1));
  }

  /** The schema an editor uses for (scope, type) — most specific active, else none. */
  schemaFor(scope: FormScope, type?: CatalogType): FormSchema | undefined {
    return this.schemasFor(scope, type)[0];
  }

  schema(id: string): FormSchema | undefined {
    return this.data.getFormSchema(id);
  }

  /* ---------------- the category field engine (Phase C) ---------------- */

  /**
   * The fields an asset in a category carries (Phase C): the tenant's **stock set**
   * — what every asset has — unioned with the category's own. A category field that
   * repeats a stock key overrides it (the more specific wins), so a tenant can
   * tighten a shared field per category without touching the stock set. This is the
   * consolidation: one field engine, three scopes.
   */
  fieldsFor(categoryId: string): FormField[] {
    const byKey = new Map<string, FormField>();
    for (const f of this.data.stockSchema().fields ?? []) byKey.set(f.key, f);
    for (const f of this.data.getCategory(categoryId)?.fields ?? []) byKey.set(f.key, f);
    return [...byKey.values()];
  }

  /** The category a spine type maps to within a vertical (the tab it came from). */
  categoryForType(verticalId: string, type: CatalogType): Category | undefined {
    return this.data.categoriesForVertical(verticalId, true).find((c) => c.type === type);
  }

  /**
   * An ephemeral schema for a category, so `<ims-dynamic-form>`, `coerce()`,
   * `validate()` and `defaults()` work on it unchanged — the union above, wrapped as
   * the `FormSchema` those methods take. Its id is `CAT:<category>`: a *stored*
   * schema id is only for the standalone scopes (inspection / receipt-line /
   * stock-level), because a category's fields live on the category row.
   */
  schemaForCategory(categoryId: string): FormSchema | null {
    const category = this.data.getCategory(categoryId);
    if (!category) return null;
    return {
      id: `CAT:${category.id}`,
      name: category.name,
      scope: 'item',
      type: category.type,
      active: category.active,
      version: 1,
      fields: this.fieldsFor(categoryId),
    };
  }

  /** A blank values object drawn from the schema's own `defaultValue`s. */
  defaults(schema: FormSchema | null | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of schema?.fields ?? []) {
      if (f.defaultValue !== undefined) out[f.key] = f.defaultValue;
    }
    return out;
  }

  /**
   * Coerce raw editor values (usually strings from an `<input>`) to the schema's
   * kinds and **drop every key the schema does not declare** — so an unknown key
   * can never reach a record's `attributes`. An empty value is dropped rather
   * than stored as `''`.
   */
  coerce(schema: FormSchema | null | undefined, raw: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of schema?.fields ?? []) {
      if (!(f.key in raw)) continue;
      const v = this.coerceOne(f, raw[f.key]);
      if (v === undefined || v === '') continue;
      out[f.key] = v;
    }
    return out;
  }

  /** Validate coerced values against the schema (required, kind, range, enum). */
  validate(schema: FormSchema | null | undefined, values: Record<string, unknown>): FormError[] {
    const errs: FormError[] = [];
    for (const f of schema?.fields ?? []) {
      if (f.showIf && values[f.showIf.key] !== f.showIf.equals) continue; // hidden field
      const v = values[f.key];
      const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
      if (f.required && empty) {
        errs.push({ key: f.key, message: `${f.label} is required` });
        continue;
      }
      if (empty) continue;
      switch (f.kind) {
        case 'number':
        case 'integer':
        case 'measurement': {
          const n = Number(v);
          const unit = f.unit ? ` ${f.unit}` : '';
          if (!Number.isFinite(n)) errs.push({ key: f.key, message: `${f.label} must be a number` });
          else if (f.min !== undefined && n < f.min)
            errs.push({ key: f.key, message: `${f.label} must be at least ${f.min}${unit}` });
          else if (f.max !== undefined && n > f.max)
            errs.push({ key: f.key, message: `${f.label} must be at most ${f.max}${unit}` });
          break;
        }
        case 'select': {
          if (f.options && !f.options.includes(String(v)))
            errs.push({ key: f.key, message: `${f.label} must be one of: ${f.options.join(', ')}` });
          break;
        }
        case 'multiselect': {
          const arr = Array.isArray(v) ? v.map(String) : [];
          const options = f.options;
          const bad = options ? arr.filter((x) => !options.includes(x)) : [];
          if (bad.length) errs.push({ key: f.key, message: `${f.label} has unknown choice(s): ${bad.join(', ')}` });
          break;
        }
        default: {
          const s = String(v);
          if (f.maxLength !== undefined && s.length > f.maxLength)
            errs.push({ key: f.key, message: `${f.label} must be ${f.maxLength} characters or fewer` });
          else if (f.pattern && !new RegExp(f.pattern).test(s))
            errs.push({ key: f.key, message: `${f.label} is not in the right format` });
        }
      }
    }
    return errs;
  }

  /** Coerce one value by its field's kind (see `coerce`). */
  private coerceOne(f: FormField, v: unknown): unknown {
    if (v === null || v === undefined) return undefined;
    switch (f.kind) {
      case 'number':
      case 'measurement': {
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      }
      case 'integer': {
        const n = Number(v);
        return Number.isFinite(n) ? Math.trunc(n) : undefined;
      }
      case 'boolean':
        return typeof v === 'boolean' ? v : v === 'true' || v === '1' || v === 1;
      case 'multiselect':
        return Array.isArray(v) ? v.map(String) : [];
      default:
        return String(v);
    }
  }
}
