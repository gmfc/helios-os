import assert from 'assert';
import { InMemoryFileSystem } from './index';

function testSnapshot() {
    const fs1 = new InMemoryFileSystem();
    fs1.createDirectory('/test', 0o755);
    fs1.createFile('/test/file.txt', 'hello', 0o644);
    const snapshot = fs1.getSnapshot();

    const fs2 = new InMemoryFileSystem(snapshot);
    assert(fs2.getNode('/test/file.txt'), 'file should exist after loading snapshot');
    console.log('Snapshot load test passed.');
}

function testUnmount() {
    const img = new InMemoryFileSystem();
    img.createFile('/foo.txt', 'bar', 0o644);
    const snap = img.getSnapshot();

    const fs = new InMemoryFileSystem();
    fs.mount(snap, '/mnt');
    assert(fs.getNode('/mnt/foo.txt'), 'file should exist after mount');
    fs.unmount('/mnt');
    assert(!fs.getNode('/mnt'), 'mount point removed after unmount');

    fs.createDirectory('/mnt', 0o755);
    fs.createFile('/mnt/existing.txt', 'baz', 0o644);
    fs.mount(snap, '/mnt');
    assert(fs.getNode('/mnt/foo.txt'), 'mounted file exists');
    fs.unmount('/mnt');
    assert(fs.getNode('/mnt/existing.txt'), 'existing file preserved');
    assert(fs.getNode('/mnt'), 'mount point preserved');
    assert(!fs.getNode('/mnt/foo.txt'), 'mounted file removed');
    console.log('Unmount test passed.');
}

testSnapshot();
testUnmount();

