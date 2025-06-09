import assert from 'assert';
import { createHash } from 'node:crypto';
import { Kernel } from './kernel';
import { InMemoryFileSystem } from './fs';

async function run() {
  const kernel: any = new (Kernel as any)(new InMemoryFileSystem());
  // Override runProcess to simulate asynchronous process running
  let ran = false;
  kernel.runProcess = async (pcb: any) => { ran = true; pcb.exited = true; };
  await kernel['syscall_spawn']('dummy');
  const startPromise = kernel.start();
  // wait a tick then stop
  setTimeout(() => kernel.stop(), 10);
  await startPromise;
  assert(ran, 'process should run');
  console.log('Kernel scheduler stop test passed.');

  const img = new InMemoryFileSystem();
  img.createFile('/foo.txt', 'bar', 0o644);
  const snap = img.getSnapshot();
  await kernel['syscall_mount'](snap, '/mnt');
  assert(kernel['state'].fs.getNode('/mnt/foo.txt'), 'file mounted');
  await kernel['syscall_unmount']('/mnt');
  assert(!kernel['state'].fs.getNode('/mnt/foo.txt'), 'file unmounted');
  console.log('Kernel mount/unmount test passed.');

  const pid = kernel['createProcess']();
  const pcb = kernel['state'].processes.get(pid);
  try {
    await kernel['syscall_open'](pcb, '/', 'r');
    assert.fail('opening directory should throw');
  } catch (e: any) {
    assert(e.message.includes('EISDIR'), 'EISDIR error expected');
    console.log('Kernel open directory test passed.');
  }

  const list = kernel['syscall_ps']();
  assert(Array.isArray(list) && list.length > 0, 'ps should return processes');
  console.log('Kernel ps syscall test passed.');

  // regression: syscall permissions survive snapshot/restore
  const permKernel: any = new (Kernel as any)(new InMemoryFileSystem());
  const pid2 = await permKernel['syscall_spawn']('dummy', { syscalls: ['ps'] });
  const permSnap = permKernel.snapshot();
  const restored: any = await (Kernel as any).restore(permSnap);
  const pcb2 = restored['state'].processes.get(pid2);
  assert(
    pcb2.allowedSyscalls instanceof Set && pcb2.allowedSyscalls.has('ps'),
    'permissions should persist after restore'
  );
  console.log('Kernel syscall permissions restore test passed.');

  // open descriptors survive snapshot/restore
  const fdKernel: any = new (Kernel as any)(new InMemoryFileSystem());
  fdKernel['state'].fs.createDirectory('/tmp', 0o755);
  fdKernel['state'].fs.createFile('/tmp/foo.txt', 'hello', 0o644);
  const pid3 = fdKernel['createProcess']();
  const pcb3 = fdKernel['state'].processes.get(pid3);
  const fd = await fdKernel['syscall_open'](pcb3, '/tmp/foo.txt', 'r');
  const snapFd = fdKernel.snapshot();
  const restoredFd: any = await (Kernel as any).restore(snapFd);
  const pcbRestored = restoredFd['state'].processes.get(pid3);
  const data = await restoredFd['syscall_read'](pcbRestored, fd, 5);
  assert(new TextDecoder().decode(data) === 'hello', 'open descriptor restored');
  console.log('Kernel fd restore test passed.');

  // snapshot save/load preserves fs hash and window list
  const snapKernel: any = new (Kernel as any)(new InMemoryFileSystem());
  snapKernel['state'].fs.createDirectory('/snap', 0o755);
  snapKernel['state'].fs.createFile('/snap/test.txt', 'data', 0o644);
  snapKernel['syscall_draw'](new TextEncoder().encode('<p>hi</p>'), { title: 't' });
  const hash1 = createHash('sha256')
    .update(JSON.stringify(snapKernel['state'].fs.getSnapshot()))
    .digest('hex');
  const snapshot = snapKernel.snapshot();
  const restoredSnap: any = await (Kernel as any).restore(snapshot);
  const hash2 = createHash('sha256')
    .update(JSON.stringify(restoredSnap['state'].fs.getSnapshot()))
    .digest('hex');
  assert.strictEqual(hash1, hash2, 'filesystem hash should match after restore');
  assert.deepStrictEqual(
    restoredSnap['state'].windows,
    snapKernel['state'].windows,
    'windows should restore identically'
  );
  console.log('Kernel snapshot save/load test passed.');
}

run();
