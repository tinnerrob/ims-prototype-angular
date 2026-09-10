import { Component } from '@angular/core';

import { ModalDismissDirective } from '../modal-dismiss/modal-dismiss.directive';
import { ConfirmService } from './confirm.service';

/**
 * The single confirmation prompt host, mounted once in the app shell
 * (see `ConfirmService`). It renders whatever prompt is pending and sits above
 * the editor modals, so a prompt triggered by closing a modal is drawn on top
 * of that modal.
 */
@Component({
  selector: 'ims-confirm-dialog',
  standalone: true,
  imports: [ModalDismissDirective],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
})
export class ConfirmDialogComponent {
  constructor(readonly confirm: ConfirmService) {}
}
