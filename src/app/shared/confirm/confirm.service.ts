import { Injectable } from '@angular/core';

/**
 * Copy for a confirmation prompt. `title` / labels get sensible defaults, so
 * callers only have to supply the question itself.
 */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

export const CONFIRM_DEFAULTS: ConfirmRequest = {
  title: 'Discard changes?',
  message: 'This editor has unsaved changes. Closing it will discard them.',
  confirmLabel: 'Discard',
  cancelLabel: 'Keep editing',
};

/**
 * App-wide confirmation prompts (one at a time), rendered by
 * `ims-confirm-dialog` in the app shell.
 *
 * The prompt is a *promise* rather than an event so callers read top-to-bottom:
 *
 *     if (await this.confirm.ask({ message: 'Remove this record?' })) { ... }
 *
 * `ModalDismissDirective` uses it to ask before throwing away unsaved form
 * edits; anything else that needs a yes/no can use it too.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  /** The prompt the dialog is showing, or null when nothing is pending. */
  pending: ConfirmRequest | null = null;

  private resolver: ((ok: boolean) => void) | null = null;

  /** Show a prompt and resolve when the user answers (`true` = proceed). */
  ask(request: Partial<ConfirmRequest>): Promise<boolean> {
    // A second prompt supersedes the first, which can only be answered "no".
    if (this.resolver) this.settle(false);
    this.pending = { ...CONFIRM_DEFAULTS, ...request };
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  /** Answer the pending prompt — from its buttons, or a backdrop click. */
  settle(ok: boolean): void {
    const resolve = this.resolver;
    this.resolver = null;
    this.pending = null;
    resolve?.(ok);
  }
}
