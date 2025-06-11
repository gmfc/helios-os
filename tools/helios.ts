import { Kernel } from "../core/kernel";
import * as fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { fileURLToPath } from "node:url";

export async function snap(outPath: string) {
    const kernel = await Kernel.create();
    const state = kernel.snapshot();
    await fs.writeFile(outPath, JSON.stringify(state, null, 2));
    console.log(`Snapshot saved to ${outPath}`);
}

export async function makepkg(dir: string) {
    const metaPath = path.join(dir, "pkg.json");
    const raw = await fs.readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw);
    const outName = `${meta.name ?? path.basename(dir)}-${meta.version ?? "0.0.0"}.tar.gz`;
    await tar.create({ gzip: true, file: outName, cwd: dir }, ["."]);
    console.log(`Package created: ${outName}`);
}

export async function scaffoldGuiApp(name: string) {
    const dir = path.join("apps", "examples", name);
    await fs.mkdir(dir, { recursive: true });
    const mainPath = path.join(dir, "index.tsx");
    const code = `import type { SyscallDispatcher } from '../../types/syscalls';

export async function main(syscall: SyscallDispatcher): Promise<number> {
    const html = new TextEncoder().encode('<h1>${name} works!</h1>');
    await syscall('draw', html, { title: '${name}' });
    return 0;
}
`;
    await fs.writeFile(mainPath, code);
    console.log(`GUI app created at ${dir}`);
}

export async function updateSnapshot(outPath = "snapshot.json") {
    const kernel = await Kernel.create();
    const snapData = kernel.snapshot();
    await fs.writeFile(outPath, JSON.stringify(snapData, null, 2));
    console.log(`Snapshot updated: ${outPath}`);
}

export async function main() {
    const [command, sub, arg] = process.argv.slice(2);
    if (!command) {
        console.log("Usage: helios <snap|makepkg|new|update-snapshot> [args]");
        process.exit(1);
    }
    switch (command) {
        case "snap":
            if (!sub) throw new Error("snap requires output path");
            await snap(sub);
            break;
        case "makepkg":
            if (!sub) throw new Error("makepkg requires directory");
            await makepkg(sub);
            break;
        case "new":
            if (sub !== "gui-app" || !arg) {
                console.log("Usage: helios new gui-app <name>");
                process.exit(1);
            }
            await scaffoldGuiApp(arg);
            break;
        case "update-snapshot":
            await updateSnapshot(sub ?? "snapshot.json");
            break;
        default:
            console.error(`Unknown command: ${command}`);
            process.exit(1);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
