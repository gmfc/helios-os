import { build as esbuild, context } from "esbuild";
import { builtinModules } from "module";
import { copyFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

interface BuildOptions {
    dev?: boolean;
    outDir?: string;
    watch?: boolean;
    serve?: boolean;
}

export async function buildUI(opts: BuildOptions = {}) {
    const devEnv = process.env.NODE_ENV;
    const dev =
        opts.dev ?? (devEnv ? devEnv !== "production" : true);
    const outDir = opts.outDir ?? process.env.OUT_DIR ?? "dist";
    const watch = opts.watch ?? (process.env.WATCH === "true");
    const serve = opts.serve ?? false;

    await mkdir(outDir, { recursive: true });

    const externals = [
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        "@tauri-apps/api",
        "@tauri-apps/plugin-clipboard-manager",
        "@tauri-apps/plugin-sql",
    ];

    const ctx = await context({
        entryPoints: [path.join("ui", "index.tsx")],
        bundle: true,
        outfile: path.join(outDir, "bundle.js"),
        platform: "browser",
        target: "esnext",
        tsconfig: path.join("tsconfig.json"),
        sourcemap: dev,
        minify: !dev,
        external: externals,
    });

    if (watch) {
        await ctx.watch();
    }

    if (serve) {
        await ctx.serve({ port: 1420, servedir: "." });
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }

    await copyFile(
        path.join("ui", "index.html"),
        path.join(outDir, "index.html"),
    );
}

function parseArgs(args: string[]): BuildOptions {
    const opts: BuildOptions = {};
    for (const arg of args) {
        if (arg === "--dev") opts.dev = true;
        else if (arg === "--prod" || arg === "--production") opts.dev = false;
        else if (arg.startsWith("--outDir=")) opts.outDir = arg.split("=")[1];
        else if (arg === "--watch") opts.watch = true;
        else if (arg === "--serve") opts.serve = true;
    }
    return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const opts = parseArgs(process.argv.slice(2));
    buildUI(opts).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
