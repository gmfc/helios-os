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

async function writeBuildScript(
    dir: string,
    entry: string,
    platform: "browser" | "node",
) {
    const build = `import { build } from 'esbuild';\n` +
        `import { copyFile, mkdir } from 'fs/promises';\n\n` +
        `await mkdir('dist', { recursive: true });\n` +
        `await build({\n` +
        `    entryPoints: ['${entry}'],\n` +
        `    bundle: true,\n` +
        `    outfile: 'dist/bundle.js',\n` +
        `    platform: '${platform}',\n` +
        `    tsconfig: '../../tsconfig.json',\n` +
        `});\n` +
        (platform === "browser"
            ? `await copyFile('index.html', 'dist/index.html');\n`
            : "");
    await fs.writeFile(path.join(dir, "build.ts"), build);
}

export async function scaffoldGuiApp(name: string) {
    const dir = path.join("apps", "examples", name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
        path.join(dir, "main.tsx"),
        `import type { SyscallDispatcher } from '../../types/syscalls';\n\n` +
            `export async function main(syscall: SyscallDispatcher): Promise<number> {\n` +
            `    const html = new TextEncoder().encode('<h1>${name} works!</h1>');\n` +
            `    await syscall('draw', html, { title: '${name}' });\n` +
            `    return 0;\n` +
            `}\n`,
    );

    await fs.writeFile(
        path.join(dir, "index.html"),
        `<!DOCTYPE html>\n<html lang='en'>\n<head>\n    <meta charset='UTF-8'>\n    <title>${name}</title>\n</head>\n<body>\n    <div id='root'></div>\n    <script src='./bundle.js'></script>\n</body>\n</html>\n`,
    );

    await fs.writeFile(
        path.join(dir, "pkg.json"),
        JSON.stringify({ name, version: "0.1.0", syscalls: [] }, null, 2) + "\n",
    );

    await writeBuildScript(dir, "main.tsx", "browser");

    console.log(`GUI app created at ${dir}`);
}

export async function scaffoldCliApp(name: string) {
    const dir = path.join("apps", "examples", name);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(
        path.join(dir, "main.ts"),
        `import type { SyscallDispatcher } from '../../types/syscalls';\n\n` +
            `export async function main(syscall: SyscallDispatcher): Promise<number> {\n` +
            `    await syscall('write', 1, new TextEncoder().encode('${name} works!\n'));\n` +
            `    return 0;\n` +
            `}\n`,
    );

    await fs.writeFile(
        path.join(dir, "pkg.json"),
        JSON.stringify({ name, version: "0.1.0", syscalls: [] }, null, 2) + "\n",
    );

    await writeBuildScript(dir, "main.ts", "node");

    console.log(`CLI app created at ${dir}`);
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
        console.log(
            "Usage: helios <snap|makepkg|new|update-snapshot> [args]\n" +
                "       helios new <gui-app|cli-app> <name>",
        );
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
            if (!arg || (sub !== "gui-app" && sub !== "cli-app")) {
                console.log("Usage: helios new <gui-app|cli-app> <name>");
                process.exit(1);
            }
            if (sub === "gui-app") await scaffoldGuiApp(arg);
            else await scaffoldCliApp(arg);
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
