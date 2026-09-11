import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { provideImsApi } from './core/api';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // The API seam (C1): which implementation answers the contract is decided here and
    // nowhere else. Features ask for `IMS_API`; today that is the store (the app's
    // database), later it is an HTTP client — and nothing else in the app changes.
    provideImsApi(),
  ],
};
