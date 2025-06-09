import assert from 'assert';
import { createHash } from 'node:crypto';
import { Kernel } from './kernel';
import { InMemoryFileSystem } from './fs';

function checksum(obj: any): string {
    return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

async function run() {
    const kernel: any = new (Kernel as any)(new InMemoryFileSystem());
    const snap1 = kernel.snapshot();
    const restored1: any = await (Kernel as any).restore(snap1);
    const snap2 = restored1.snapshot();
    const restored2: any = await (Kernel as any).restore(snap2);
    const snap3 = restored2.snapshot();
    assert.strictEqual(checksum(snap2), checksum(snap3), 'snapshot checksums must match');
    console.log('Snapshot deterministic load test passed.');
}

run();
