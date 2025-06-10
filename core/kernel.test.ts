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

  // ps should report cpu/mem usage and tty information
  const psKernel: any = new (Kernel as any)(new InMemoryFileSystem());
  let runs = 0;
  psKernel.runProcess = async (pcb: any) => {
    pcb.exitCode = 0;
    pcb.cpuMs += 5;
    pcb.memBytes += 1024;
    runs++;
    if (runs >= 2) pcb.exited = true;
  };
  const psPid = await psKernel['syscall_spawn']('dummy', { tty: '/dev/tty1' });
  const psPcb = psKernel['state'].processes.get(psPid);
  await psKernel.runProcess(psPcb);
  await psKernel.runProcess(psPcb);
  const psList = psKernel['syscall_ps']();
  const proc = psList.find((p: any) => p.pid === psPid);
  assert(proc && proc.cpuMs === 10 && proc.memBytes === 2048 && proc.tty === '/dev/tty1',
    'ps should return accumulated cpu/mem and tty');
  console.log('Kernel ps resource accumulation test passed.');

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

  // scheduler timeslicing requeues running process
  globalThis.window = {} as any;
  globalThis.window.crypto = {
    getRandomValues: (arr: Uint32Array) => require('crypto').randomFillSync(arr)
  };
  const { mockIPC, clearMocks } = await import('@tauri-apps/api/mocks');
  let slices = 0;
  mockIPC((_cmd, _args) => {
    slices++;
    if (slices < 3) {
      return { running: true, cpu_ms: 1, mem_bytes: 0 };
    }
    return { running: false, exit_code: 0, cpu_ms: 1, mem_bytes: 0 };
  });
  const schedKernel: any = new (Kernel as any)(new InMemoryFileSystem());
  await schedKernel['syscall_spawn']('dummy', { quotaMs: 1 });
  const schedStart = schedKernel.start();
  setTimeout(() => schedKernel.stop(), 10);
  await schedStart;
  clearMocks();
  // @ts-ignore
  delete globalThis.window;
  assert(slices >= 3, 'process should be requeued multiple times');
  console.log('Kernel scheduler timeslice test passed.');

  // persistent isolate accumulates resources across slices
  globalThis.window = {} as any;
  globalThis.window.crypto = {
    getRandomValues: (arr: Uint32Array) => require('crypto').randomFillSync(arr)
  };
  const { mockIPC: mockPersist, clearMocks: clearPersist } = await import('@tauri-apps/api/mocks');
  const calls: any[] = [];
  mockPersist((cmd, args) => {
    if (cmd === 'run_isolate_slice') {
      calls.push(args);
      if (calls.length === 1) {
        return { running: true, cpu_ms: 2, mem_bytes: 100 };
      }
      return { running: false, exit_code: 0, cpu_ms: 3, mem_bytes: 150 };
    }
    return undefined;
  });
  const persistKernel: any = new (Kernel as any)(new InMemoryFileSystem());
  const persistPid = await persistKernel['syscall_spawn']('dummy', { quotaMs: 1 });
  const persistPcb = persistKernel['state'].processes.get(persistPid);
  await persistKernel['runProcess'](persistPcb);
  await persistKernel['runProcess'](persistPcb);
  clearPersist();
  // @ts-ignore
  delete globalThis.window;
  assert.strictEqual(calls.length, 2, 'host called twice');
  assert('code' in calls[0], 'first slice should include code');
  assert(!('code' in calls[1]), 'subsequent slice should omit code');
  assert.strictEqual(persistPcb.cpuMs, 5, 'CPU time accumulates');
  assert.strictEqual(persistPcb.memBytes, 250, 'memory usage accumulates');
  assert.strictEqual(persistPcb.exited, true, 'process should exit');
  console.log('Kernel persistent isolate accumulation test passed.');

  // job table management
  const jobKernel: any = new (Kernel as any)(new InMemoryFileSystem());
  const jid = jobKernel.registerJob([123], 'sleep 1');
  let jobList = jobKernel['syscall_jobs']();
  assert.strictEqual(jobList.length, 1, 'job should register');
  assert.strictEqual(jobList[0].id, jid, 'job id matches');
  jobKernel.updateJobStatus(jid, 'Done');
  jobList = jobKernel['syscall_jobs']();
  assert.strictEqual(jobList[0].status, 'Done', 'status updates');
  jobKernel.removeJob(jid);
  assert.strictEqual(jobKernel['syscall_jobs']().length, 0, 'job removal');
  console.log('Kernel job table test passed.');

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

  // /proc filesystem
  const procKernel: any = new (Kernel as any)(new InMemoryFileSystem());
  const procPid = procKernel['createProcess']();
  const procPcb = procKernel['state'].processes.get(procPid);
  procKernel['state'].fs.createDirectory('/tmp', 0o755);
  procKernel['state'].fs.createFile('/tmp/foo.txt', 'bar', 0o644);
  const f = await procKernel['syscall_open'](procPcb, '/tmp/foo.txt', 'r');
  const fdList = await procKernel['syscall_readdir'](`/proc/${procPid}/fd`);
  assert(fdList.some((n: any) => n.path === `/proc/${procPid}/fd/${f}`), '/proc/<pid>/fd lists open descriptors');
  const sfd = await procKernel['syscall_open'](procPcb, `/proc/${procPid}/status`, 'r');
  const stat = await procKernel['syscall_read'](procPcb, sfd, 1024);
  const text = new TextDecoder().decode(stat);
  assert(text.includes('pid\t' + procPid) || text.includes('pid:\t' + procPid), 'status file readable');
  console.log('/proc filesystem test passed.');

  try {
    await procKernel['syscall_open'](procPcb, `/proc/${procPid + 1}/status`, 'r');
    assert.fail('opening nonexistent /proc entry should throw');
  } catch (e: any) {
    assert(e.message.includes('ENOENT'), 'ENOENT expected for missing process');
  }

  try {
    await procKernel['syscall_open'](procPcb, `/proc/${procPid}/fd/${procPcb.nextFd}`, 'r');
    assert.fail('opening nonexistent fd should throw');
  } catch (e: any) {
    assert(e.message.includes('ENOENT'), 'ENOENT expected for missing fd');
  }
  console.log('Kernel /proc ENOENT tests passed.');

  // kill syscall terminates a process
  const killKernel: any = new (Kernel as any)(new InMemoryFileSystem());
  const killPid = await killKernel['syscall_spawn']('dummy');
  const killPcb = killKernel['state'].processes.get(killPid);
  const killRes = killKernel['syscall_kill'](killPid, 9);
  assert.strictEqual(killRes, 0, 'kill should return 0');
  assert.strictEqual(killPcb.exited, true, 'process should be marked exited');
  console.log('Kernel kill syscall test passed.');

  // init process cannot be killed
  const initKernel: any = new (Kernel as any)(new InMemoryFileSystem());
  const initPid = await initKernel['syscall_spawn']('dummy');
  initKernel['initPid'] = initPid;
  const initRes = initKernel['syscall_kill'](initPid, 9);
  assert.strictEqual(initRes, -1, 'killing init should fail');
  const initPcb = initKernel['state'].processes.get(initPid);
  assert.strictEqual(initPcb.exited, false, 'init should remain running');
  console.log('Kernel init kill protection test passed.');

  // memory quota enforcement
  globalThis.window = {} as any;
  globalThis.window.crypto = {
    getRandomValues: (arr: Uint32Array) => require('crypto').randomFillSync(arr)
  };
  const { mockIPC: mockQuota, clearMocks: clearQuota } = await import('@tauri-apps/api/mocks');
  mockQuota(() => ({ running: true, cpu_ms: 1, mem_bytes: 2048 }));
  const quotaKernel: any = new (Kernel as any)(new InMemoryFileSystem());
  const quotaPid = await quotaKernel['syscall_spawn']('dummy', { quotaMs: 1 });
  const quotaPcb = quotaKernel['state'].processes.get(quotaPid);
  quotaKernel['syscall_set_quota'](quotaPcb, undefined, 1024);
  await quotaKernel['runProcess'](quotaPcb);
  clearQuota();
  // @ts-ignore
  delete globalThis.window;
  assert.strictEqual(quotaPcb.exited, true, 'process should exit when exceeding memory quota');
  console.log('Kernel memory quota enforcement test passed.');
}

run();
