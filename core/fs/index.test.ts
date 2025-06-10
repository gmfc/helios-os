import assert from "assert";
import { test } from "vitest";
import { InMemoryFileSystem } from "./index";

function testSnapshot() {
    const fs1 = new InMemoryFileSystem();
    fs1.createDirectory("/test", 0o755);
    fs1.createFile("/test/file.txt", "hello", 0o644);
    const snapshot = fs1.getSnapshot();

    const fs2 = new InMemoryFileSystem(snapshot);
    assert(
        fs2.getNode("/test/file.txt"),
        "file should exist after loading snapshot",
    );
    console.log("Snapshot load test passed.");
}

function testUnmount() {
    const img = new InMemoryFileSystem();
    img.createFile("/foo.txt", "bar", 0o644);
    const snap = img.getSnapshot();

    const fs = new InMemoryFileSystem();
    fs.mount(snap, "/mnt");
    assert(fs.getNode("/mnt/foo.txt"), "file should exist after mount");
    fs.unmount("/mnt");
    assert(!fs.getNode("/mnt"), "mount point removed after unmount");

    fs.createDirectory("/mnt", 0o755);
    fs.createFile("/mnt/existing.txt", "baz", 0o644);
    fs.mount(snap, "/mnt");
    assert(fs.getNode("/mnt/foo.txt"), "mounted file exists");
    fs.unmount("/mnt");
    assert(fs.getNode("/mnt/existing.txt"), "existing file preserved");
    assert(fs.getNode("/mnt"), "mount point preserved");
    assert(!fs.getNode("/mnt/foo.txt"), "mounted file removed");
    console.log("Unmount test passed.");
}

test("snapshot load", testSnapshot);
test("unmount", testUnmount);

function testDirOps() {
    const fs = new InMemoryFileSystem();
    fs.createDirectory("/dir", 0o755);
    fs.createFile("/dir/file.txt", "data", 0o644);
    const list = fs.listDirectory("/dir");
    assert(
        list.some((n) => n.path === "/dir/file.txt"),
        "file listed",
    );
    fs.rename("/dir/file.txt", "/dir/renamed.txt");
    assert(fs.getNode("/dir/renamed.txt"), "rename works");
    fs.remove("/dir/renamed.txt");
    assert(!fs.getNode("/dir/renamed.txt"), "file removed");
    console.log("Directory ops test passed.");
}

test("directory operations", testDirOps);

function testFileDataPersistence() {
    const fs = new InMemoryFileSystem();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fs.createFile("/bin/data.bin", bytes, 0o644);
    const snap = fs.getSnapshot();
    const fs2 = new InMemoryFileSystem(snap);
    const read = fs2.readFile("/bin/data.bin");
    assert(
        read.length === bytes.length && read.every((b, i) => b === bytes[i]),
        "binary data should persist",
    );
    console.log("File data persistence test passed.");
}

test("file data persistence", testFileDataPersistence);
