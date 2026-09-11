import { Component, Inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { ApiAdapter, IMS_API } from '../../core/api';
import { DemoAccount, roleLabel, SignInFailure } from '../../core/models';
import { SessionService } from '../../core/session.service';

/** What the form says for each refusal `signIn()` can answer with (B1's union). */
const REFUSAL: Record<SignInFailure, string> = {
  invalid: 'That email address and password do not match an account in this workspace.',
  inactive: 'That person has been deactivated — ask an administrator to restore access.',
};

/**
 * The sign-in screen (B2) — the first thing an unauthenticated visitor meets, and the
 * only route that renders outside the app shell.
 *
 * It asks for the credential pair and decides nothing: the store compares the digest
 * (`signIn()`), so this component carries the answer back and prints the reason it
 * gives. The pick-list below the form is the *fixture's* — the six seeded roles are
 * the demonstration and this screen publishes the passwords that enter each one
 * (see `DataService.demoAccounts()`); a real deployment has no such list, and the
 * credential it is proving never leaves the store.
 *
 * B3 added one sentence this screen does have an opinion about: when the guard says
 * the session *ended* (`?expired=1`), it says so, because a person who was working a
 * minute ago is owed the reason they are back here.
 */
@Component({
  selector: 'ims-sign-in',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './sign-in.component.html',
  styleUrl: './sign-in.component.scss',
})
export class SignInComponent {
  /** The fixture's people, each with the password this screen publishes. */
  readonly accounts: DemoAccount[];
  /** True when the guard sent the visitor here because their session ran out (B3). */
  readonly endedSession: boolean;

  email = '';
  password = '';
  /** What the last refusal said ('' before the first attempt). */
  readonly error = signal('');
  /** True while a credential is being checked — the button says so. */
  readonly busy = signal(false);

  constructor(
    @Inject(IMS_API) data: ApiAdapter,
    private readonly session: SessionService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
  ) {
    // Assigned here, not as a field initializer: a field runs *before* the
    // constructor's parameters exist, so reading an injected service there is the
    // blank-screen bug `lint:ctor` exists to catch.
    this.accounts = data.demoAccounts();
    // A lapse and a first visit are not the same thing (B3): the guard marks the
    // first, so an idle tab gets an explanation instead of looking like a reload that
    // threw the person out for no reason.
    this.endedSession = this.route.snapshot.queryParamMap.get('expired') === '1';
  }

  /** The workspace being signed into — named, so the form is not anonymous. */
  tenantName(): string {
    return this.session.tenant()?.name ?? '';
  }

  /** Role label for a demo row: the bundle, so the list names what each one grants. */
  roleName(account: DemoAccount): string {
    return roleLabel(account.role);
  }

  /** A demo row: fill the form *and* try it — the fixture's passwords are public. */
  async useAccount(account: DemoAccount): Promise<void> {
    this.email = account.email;
    this.password = account.password;
    await this.submit();
  }

  /** Prove the pair. Nothing here compares anything; the store answers. */
  async submit(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const result = await this.session.signIn(this.email, this.password);
    this.busy.set(false);
    // The password leaves the field either way: a refusal must not leave it sitting
    // in a form, and the session it started has no use for it.
    this.password = '';
    if (!result.ok) {
      this.error.set(REFUSAL[result.reason]);
      return;
    }
    await this.router.navigateByUrl(this.next());
  }

  /**
   * Where to land after signing in: the URL the guard interrupted, when it named one
   * — so a deep link survives the sign-in. Only a path on *this* app is honoured (a
   * leading `/` and not `//host`), so a crafted `?next=` cannot turn the form into an
   * open redirect.
   */
  private next(): string {
    const wanted = this.route.snapshot.queryParamMap.get('next') ?? '';
    return wanted.startsWith('/') && !wanted.startsWith('//') ? wanted : '/dashboard';
  }
}