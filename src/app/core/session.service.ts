import { computed, Inject, Injectable, Signal } from '@angular/core';

import { ApiAdapter, IMS_API } from './api';
import { can, Permission, RoleDef, roleDef, SessionTouch, SignInResult, Tenant, User } from './models';

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
 * set the acting person at all — the demo switcher that used to is gone.
 *
 * B3 gave the session an end. `touch()` is what the route guard asks on every
 * navigation: it rolls the session's expiry while it is still valid, and reports a
 * lapse — which the store has already *cleared*, and which its readers stopped
 * honouring the moment the stamp passed — separately from "nobody was signed in",
 * because the form says different things for those two.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  /** The workspace the session acts as. */
  readonly tenant: Signal<Tenant | undefined>;
  /** The person the app is acting as (undefined while signed out). */
  readonly user: Signal<User | undefined>;
  /** The current user's role definition (label + permission list). */
  readonly role: Signal<RoleDef>;

  constructor(@Inject(IMS_API) private readonly data: ApiAdapter) {
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

  /**
   * Ask the session to continue (B3) — the guard's one question, and the place a lapse
   * is *ended* (the store's readers have already stopped honouring it; this is what
   * clears it and persists that). The answer is in data (`SessionTouch`); the service
   * does not decide what a lapse means, it carries the answer to whoever asked.
   */
  touch(): SessionTouch {
    return this.data.touchSession();
  }
}
