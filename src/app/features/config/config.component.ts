import { Component } from '@angular/core';

import { ModulesService } from '../../core/modules.service';
import { INDUSTRY_MODULES } from '../../core/models';

@Component({
  selector: 'ims-config',
  standalone: true,
  templateUrl: './config.component.html',
  styleUrl: './config.component.scss',
})
export class ConfigComponent {
  readonly modules = INDUSTRY_MODULES;

  constructor(readonly mods: ModulesService) {}

  on(moduleKey: string): boolean {
    return this.mods.isEnabled(moduleKey as Parameters<ModulesService['isEnabled']>[0]);
  }

  toggle(key: string): void {
    this.mods.setEnabled(key as Parameters<ModulesService['setEnabled']>[0], !this.on(key));
  }
}
