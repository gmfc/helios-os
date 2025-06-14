import { buildSync } from "esbuild";
import { readdirSync, writeFileSync, readFileSync } from "fs";
import { builtinModules } from "module";
import path from "path";
import vm from "vm";

const root = path.resolve(__dirname, "..");
const programsDir = path.join(root, "apps", "cli", "programs");
const tsconfig = path.join(root, "tsconfig.json");

const NODE_APIS = new Set([...builtinModules, "electron"]);

function detectNodeApis(src: string): string[] {
    const hits: string[] = [];
    for (const mod of NODE_APIS) {
        const pattern = new RegExp(
            `(?:from\\s+|require\\(|import\\()\\s*['"](?:node:)?${mod}['"]`,
            "g",
        );
        if (pattern.test(src)) {
            hits.push(mod);
        }
    }
    return hits;
}

const manifests: Record<string, any> = {
    cat: { name: "cat", syscalls: ["open", "read", "write", "close"] },
    echo: { name: "echo", syscalls: ["open", "write", "close"] },
    nano: { name: "nano", syscalls: ["open", "read", "write", "close", "draw"] },
    browser: { name: "browser", syscalls: ["draw"] },
    ping: { name: "ping", syscalls: ["udp_connect", "udp_send", "write"] },
    desktop: { name: "desktop", syscalls: ["open", "read", "write", "close", "spawn", "draw"] },
    startx: { name: "startx", syscalls: ["open", "read", "write", "close", "spawn"] },
    ls: { name: "ls", syscalls: ["readdir", "write"] },
    mkdir: { name: "mkdir", syscalls: ["mkdir", "write"] },
    rm: { name: "rm", syscalls: ["unlink", "write"] },
    mv: { name: "mv", syscalls: ["rename", "write"] },
    ps: { name: "ps", syscalls: ["ps", "write"] },
    kill: { name: "kill", syscalls: ["kill", "jobs"] },
    sleep: { name: "sleep", syscalls: [] },
    ulimit: { name: "ulimit", syscalls: ["set_quota", "write"] },
    dhclient: {
        name: "dhclient",
        syscalls: ["dhcp_request", "write"],
    },
    iwlist: { name: "iwlist", syscalls: ["wifi_scan", "write"] },
    iwconfig: { name: "iwconfig", syscalls: ["wifi_join", "write"] },
    route: { name: "route", syscalls: ["route_add", "route_del", "write"] },
    ifconfig: {
        name: "ifconfig",
        syscalls: [
            "list_nics",
            "nic_up",
            "nic_down",
            "nic_config",
            "write",
        ],
    },
    sendmail: { name: "sendmail", syscalls: ["connect", "write"] },
    mail: { name: "mail", syscalls: ["connect", "write"] },
    apt: { name: "apt", syscalls: ["open", "read", "write", "close", "mkdir"] },
    themes: { name: "themes", syscalls: ["open", "write", "close", "mkdir"] },
    setfont: { name: "setfont", syscalls: ["open", "read", "write", "close", "mkdir"] },
    keymap: { name: "keymap", syscalls: ["open", "read", "write", "close", "mkdir"] },
    service: {
        name: "service",
        syscalls: [
            "open",
            "read",
            "write",
            "close",
            "spawn",
            "list_services",
            "stop_service",
        ],
    },
    ssh: {
        name: "ssh",
        syscalls: ["listen", "open", "read", "write", "close", "spawn", "ps"],
    },
    httpd: {
        name: "httpd",
        syscalls: ["listen", "open", "read", "write", "close"],
        allowNode: true,
    },
    ftpd: {
        name: "ftpd",
        syscalls: [
            "listen",
            "connect",
            "open",
            "read",
            "write",
            "close",
            "readdir",
        ],
    },
    smtp: {
        name: "smtp",
        syscalls: ["listen", "open", "write", "mkdir", "close"],
        allowNode: true,
    },
    bugreport: {
        name: "bugreport",
        syscalls: ["open", "read", "write", "close", "readdir", "mkdir"],
    },
    tutorial: { name: "tutorial", syscalls: ["write"] },
    bash: {
        name: "bash",
        syscalls: [
            "open",
            "read",
            "write",
            "close",
            "spawn",
            "ps",
            "jobs",
            "kill",
            "set_quota",
        ],
    },
    login: { name: "login", syscalls: ["open", "read", "write", "close", "spawn"] },
    init: { name: "init", syscalls: ["open", "read", "write", "close", "spawn"] },
    reboot: { name: "reboot", syscalls: ["reboot"] },
    snapshot: {
        name: "snapshot",
        syscalls: [
            "snapshot",
            "save_snapshot_named",
            "load_snapshot_named",
            "reboot",
            "write",
        ],
    },
};

const bundledOrder = [
    "nano",
    "browser",
    "ping",
    "iwlist",
    "iwconfig",
    "dhclient",
    "route",
    "ifconfig",
    "sendmail",
    "mail",
    "desktop",
    "startx",
    "ls",
    "mkdir",
    "rm",
    "mv",
    "ps",
    "kill",
    "init",
    "login",
    "bash",
    "snapshot",
    "ulimit",
    "apt",
    "themes",
    "setfont",
    "keymap",
    "service",
    "ssh",
    "httpd",
    "ftpd",
    "smtp",
    "bugreport",
    "tutorial",
];

function upper(name: string): string {
    return name.toUpperCase();
}

const sources: Record<string, string> = {};
for (const file of readdirSync(programsDir)) {
    if (!file.endsWith(".ts")) continue;
    const name = path.basename(file, ".ts");
    const fullPath = path.join(programsDir, file);
    const tsSource = readFileSync(fullPath, "utf8");
    const usedApis = detectNodeApis(tsSource);
    if (usedApis.length > 0 && !manifests[name]?.allowNode) {
        throw new Error(
            `${file} uses Node/Electron APIs: ${usedApis.join(", ")}. ` +
                "Add allowNode: true to its manifest to permit this."
        );
    }
    const res = buildSync({
        entryPoints: [fullPath],
        platform: "node",
        format: "cjs",
        bundle: true,
        write: false,
        tsconfig,
    });
    const code = res.outputFiles?.[0]?.text ?? "";
    const mod = { exports: {} as any };
    vm.runInNewContext(code, { module: mod, exports: mod.exports, require });
    const fn = (mod.exports as any).main;
    if (typeof fn !== "function") {
        throw new Error(`No main function in ${file}`);
    }
    sources[name] = fn.toString();
}

let out = "// This file is generated by tools/build-apps.ts\n";
out += "// Do not edit manually.\n\n";

for (const name of Object.keys(sources).sort((a, b) => a.localeCompare(b))) {
    out += `export const ${upper(name)}_SOURCE = ${JSON.stringify(sources[name])};\n`;
}

out += "\n";
for (const name of Object.keys(manifests).sort((a, b) => a.localeCompare(b))) {
    const m = manifests[name];
    out += `export const ${upper(name)}_MANIFEST = JSON.stringify(${JSON.stringify(m, null, 4)});\n`;
}

out += "\nexport const BUNDLED_APPS = new Map<string, string>([\n";
for (const name of bundledOrder) {
    out += `    [\"${name}\", ${upper(name)}_SOURCE],\n`;
}
out += "]);\n";

writeFileSync(path.join(root, "core", "fs", "generatedApps.ts"), out + "\n");
