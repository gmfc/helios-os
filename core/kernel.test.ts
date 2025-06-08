import assert from 'assert';
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
  kernel['syscall_mount'](snap, '/mnt');
  assert(kernel['state'].fs.getNode('/mnt/foo.txt'), 'file mounted');
  kernel['syscall_unmount']('/mnt');
  assert(!kernel['state'].fs.getNode('/mnt/foo.txt'), 'file unmounted');
  console.log('Kernel mount/unmount test passed.');

  const pid = kernel['createProcess']();
  const pcb = kernel['state'].processes.get(pid);
  try {
    kernel['syscall_open'](pcb, '/', 'r');
    assert.fail('opening directory should throw');
  } catch (e: any) {
    assert(e.message.includes('EISDIR'), 'EISDIR error expected');
    console.log('Kernel open directory test passed.');
  }

  const list = kernel['syscall_ps']();
  assert(Array.isArray(list) && list.length > 0, 'ps should return processes');
  console.log('Kernel ps syscall test passed.');
}

run();
