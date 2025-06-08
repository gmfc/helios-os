export * from './browser';
export * from './sshClient';
export * from './nano';
export * from './webBrowser';
export * from './ping';
export * from './desktop';
export * from './ls';
export * from './mkdir';
export * from './rm';
export * from './mv';

import {
  NANO_SOURCE,
  BROWSER_SOURCE,
  PING_SOURCE,
  DESKTOP_SOURCE,
  LS_SOURCE,
  MKDIR_SOURCE,
  RM_SOURCE,
  MV_SOURCE,
} from '../core/fs/bin';

export const BUNDLED_APPS = new Map<string, string>([
  ['nano', NANO_SOURCE],
  ['browser', BROWSER_SOURCE],
  ['ping', PING_SOURCE],
  ['desktop', DESKTOP_SOURCE],
  ['ls', LS_SOURCE],
  ['mkdir', MKDIR_SOURCE],
  ['rm', RM_SOURCE],
  ['mv', MV_SOURCE],
]);
