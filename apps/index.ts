export * from './browser';
export * from './sshClient';
export * from './nano';
export * from './webBrowser';
export * from './ping';

import { NANO_SOURCE, BROWSER_SOURCE, PING_SOURCE } from '../core/fs/bin';

export const BUNDLED_APPS = new Map<string, string>([
  ['nano', NANO_SOURCE],
  ['browser', BROWSER_SOURCE],
  ['ping', PING_SOURCE],
]);
