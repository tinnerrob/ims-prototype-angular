import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { ModuleKey } from './models';
import { ModulesService } from './modules.service';

/** Route guard: block access to a disabled industry module (falls back to core). */
export function requireModule(key: ModuleKey): CanActivateFn {
  return () => {
    const modules = inject(ModulesService);
    const router = inject(Router);
    return modules.isEnabled(key) ? true : router.createUrlTree(['/dashboard']);
  };
}
