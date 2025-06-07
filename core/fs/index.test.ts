import assert from 'assert';
import { InMemoryFileSystem } from './index';

function run() {
  const fs1 = new InMemoryFileSystem();
  fs1.createDirectory('/test', 0o755);
  fs1.createFile('/test/file.txt', 'hello', 0o644);
  // take snapshot using public API
  const snapshot = fs1.getSnapshot();

  const fs2 = new InMemoryFileSystem(snapshot);
  assert(fs2.getNode('/test/file.txt'), 'file should exist after loading snapshot');
}

run();
console.log('Snapshot load test passed.');
