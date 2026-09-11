import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';

import { SessionService } from './session.service';

/**
 * Route guard: nothing renders without a *live* session (B2, B3).
 *
 * A signed-out client is sent to the sign-in form, carrying the URL it wanted so a
 * deep link survives the sign-in. It is registered **once**, on the pathless parent
 * every screen is a child of, rather than repeated per route — a guard a new route
 * can forget is a guard that eventually gets forgotten, and this increment's claim
 * is that no screen is reachable without a credential. It sits beside
 * `requireModule` (a licence is a different question from an identity): the module
 * guard decides whether the workspace *has* a feature, this one whether anybody is
 * allowed to look at it.
 *
 * B3 made it the app's **activity**: `session.touch()` rolls the session's expiry on
 * every navigation, and reports a lapse — clearing it in the same call, so the end is
 * persisted rather than re-derived on every render. The redirect below is therefore not
 * the only thing that stops a lapsed session: the store's readers had already stopped
 * acting as that person. A visitor who never signed in and one whose session *ended*
 * both land on the form, but they do not hear the same sentence, so the lapse carries
 * `?expired=1` while an empty session does not.
 */
export function requireAuth(): CanActivateChildFn {
  return (_route, state) => {
    const session = inject(SessionService);
    const router = inject(Router);
    const touch = session.touch();
    if (touch === 'active') return true;
    const queryParams = touch === 'lapsed' ? { next: state.url, expired: 1 } : { next: state.url };
    return router.createUrlTree(['/signin'], { queryParams });
  };
}