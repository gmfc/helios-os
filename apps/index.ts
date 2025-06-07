export * from './browser';
export * from './sshClient';
export * from './nano';
export * from './webBrowser';

import { NANO_SOURCE } from './nano';
import { BROWSER_SOURCE } from './webBrowser';

export const BUNDLED_APPS = new Map<string, string>([
  ['nano', NANO_SOURCE],
  ['browser', BROWSER_SOURCE],
]);
