import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';

import { SessionService } from './session.service';

/**
 * Route guard: nothing renders without a session (B2).
 *
 * A signed-out client is sent to the sign-in form, carrying the URL it wanted so a
 * deep link survives the sign-in. It is registered **once**, on the pathless parent
 * every screen is a child of, rather than repeated per route — a guard a new route
 * can forget is a guard that eventually gets forgotten, and this increment's claim
 * is that no screen is reachable without a credential. It sits beside
 * `requireModule` (a licence is a different question from an identity): the module
 * guard decides whether the workspace *has* a feature, this one whether anybody is
 * allowed to look at it.
 */
export function requireAuth(): CanActivateChildFn {
  return (_route, state) => {
    const session = inject(SessionService);
    const router = inject(Router);
    return session.signedIn() ? true : router.createUrlTree(['/signin'], { queryParams: { next: state.url } });
  };
}