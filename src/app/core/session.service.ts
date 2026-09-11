import { computed, Injectable, Signal } from '@angular/core';

import { DataService } from './data.service';
import { can, Permission, RoleDef, roleDef, SignInResult, Tenant, User } from './models';

/**
 * IMS — SessionService (who the app is acting as).
 *
 * The reactive face of the store's session: the workspace and the signed-in person
 * as signals, derived from the one store, so the shell and every permission-gated
 * control react to a sign-in or a sign-out. Nothing here knows what an "admin" may
 * do — callers ask `can('stock.adjust')`, which keeps the rule in one place (`ROLES`
 * in models.ts) instead of in each screen.
 *
 * B2 made it the client's only way *in*. `signIn()` proves a credential (the store
 * does the comparing) and `signOut()` ends the session, so a screen can no longer
 * set the acting person at all — the demo switcher that used to is gone, and
 * `signedIn` is what the route guard asks before it lets a screen render.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  /** The workspace the session acts as. */
  readonly tenant: Signal<Tenant | undefined>;
  /** The person the app is acting as (undefined while signed out). */
  readonly user: Signal<User | undefined>;
  /** The current user's role definition (label + permission list). */
  readonly role: Signal<RoleDef>;
  /** True while somebody is signed in — the one thing the guard needs (B2). */
  readonly signedIn: Signal<boolean>;

  constructor(private readonly data: DataService) {
    // Each computed reads `revision()` first, so any persisted write (a sign-in, a
    // sign-out, a module flag, an edit) recomputes it — no second copy of the data.
    this.tenant = computed(() => {
      this.data.revision();
      return this.data.activeTenant;
    });
    this.user = computed(() => {
      this.data.revision();
      return this.data.activeUser;
    });
    this.role = computed(() => roleDef(this.user()?.role ?? 'viewer'));
    this.signedIn = computed(() => !!this.user());
  }

  /** True when the current user's role holds the capability. */
  can(permission: Permission): boolean {
    return can(this.user(), permission);
  }

  /** True when the role holds any of the capabilities (nav entries, menus). */
  canAny(...permissions: Permission[]): boolean {
    return permissions.some((p) => this.can(p));
  }

  /**
   * Prove a credential and start a session (B2). The store does the comparing and
   * answers in data; this service only carries it, so the screen that calls it never
   * sees a credential — let alone decides whether one is right.
   */
  signIn(email: string, password: string): Promise<SignInResult> {
    return this.data.signIn(email, password);
  }

  /** End the session — the shell's **Sign out**, and the guard's other half. */
  signOut(): void {
    this.data.signOut();
  }
}
