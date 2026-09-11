import { computed, Injectable, Signal } from '@angular/core';

import { DataService } from './data.service';
import { can, Permission, roleDef, RoleDef, Tenant, User } from './models';

/**
 * IMS — SessionService (who the app is acting as).
 *
 * The stand-in for authentication until the API owns it: exposes the demo
 * workspace and the signed-in person as signals, derived from the one store, so
 * the shell and every permission-gated control react to a switch. Nothing here
 * knows what an "admin" may do — callers ask `can('stock.adjust')`, which keeps
 * the rule in one place (`ROLES` in models.ts) instead of in each screen.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  /** The workspace the session acts as. */
  readonly tenant: Signal<Tenant | undefined>;
  /** The person the app is acting as. */
  readonly user: Signal<User | undefined>;
  /** Everyone in the tenant — the switcher's list. */
  readonly users: Signal<User[]>;
  /** The current user's role definition (label + permission list). */
  readonly role: Signal<RoleDef>;

  constructor(private readonly data: DataService) {
    // Each computed reads `revision()` first, so any persisted write (a switch,
    // a module flag, an edit) recomputes it — no second copy of the data.
    this.tenant = computed(() => {
      this.data.revision();
      return this.data.activeTenant;
    });
    this.user = computed(() => {
      this.data.revision();
      return this.data.activeUser;
    });
    this.users = computed(() => {
      this.data.revision();
      return this.data.listUsers();
    });
    this.role = computed(() => roleDef(this.user()?.role ?? 'viewer'));
  }

  /** True when the current user's role holds the capability. */
  can(permission: Permission): boolean {
    return can(this.user(), permission);
  }

  /** True when the role holds any of the capabilities (nav entries, menus). */
  canAny(...permissions: Permission[]): boolean {
    return permissions.some((p) => this.can(p));
  }

  /** True when `userId` is the person we are acting as (switcher check mark). */
  isCurrent(userId: string): boolean {
    return this.user()?.id === userId;
  }

  /** Demo sign-in: act as another seeded user (follows that user's tenant). */
  switchUser(userId: string): void {
    this.data.setSessionUser(userId);
  }

  switchTenant(tenantId: string): void {
    this.data.setSessionTenant(tenantId);
  }
}
