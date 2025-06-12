/**
 * This file contains the source code for the initial binary programs
 * that will be loaded into the virtual file system.
 */
import { main as catMain } from "../../apps/cli/programs/cat";
import { main as echoMain } from "../../apps/cli/programs/echo";
import { main as nanoMain } from "../../apps/cli/programs/nano";
import { main as browserMain } from "../../apps/cli/programs/browser";
import { main as pingMain } from "../../apps/cli/programs/ping";
import { main as desktopMain } from "../../apps/cli/programs/desktop";
import { main as startxMain } from "../../apps/cli/programs/startx";
import { main as lsMain } from "../../apps/cli/programs/ls";
import { main as mkdirMain } from "../../apps/cli/programs/mkdir";
import { main as rmMain } from "../../apps/cli/programs/rm";
import { main as mvMain } from "../../apps/cli/programs/mv";
import { main as psMain } from "../../apps/cli/programs/ps";
import { main as killMain } from "../../apps/cli/programs/kill";
import { main as sleepMain } from "../../apps/cli/programs/sleep";
import { main as ulimitMain } from "../../apps/cli/programs/ulimit";
import { main as setfontMain } from "../../apps/cli/programs/setfont";
import { main as keymapMain } from "../../apps/cli/programs/keymap";
import { main as bashMain } from "../../apps/cli/programs/bash";
import { main as loginMain } from "../../apps/cli/programs/login";
import { main as initMain } from "../../apps/cli/programs/init";
import { main as rebootMain } from "../../apps/cli/programs/reboot";
import { main as snapshotMain } from "../../apps/cli/programs/snapshot";

const CAT_SOURCE = catMain.toString();
const ECHO_SOURCE = echoMain.toString();
const NANO_SOURCE = nanoMain.toString();
const BROWSER_SOURCE = browserMain.toString();
const PING_SOURCE = pingMain.toString();
const DESKTOP_SOURCE = desktopMain.toString();
const STARTX_SOURCE = startxMain.toString();
const LS_SOURCE = lsMain.toString();
const MKDIR_SOURCE = mkdirMain.toString();
const RM_SOURCE = rmMain.toString();
const MV_SOURCE = mvMain.toString();
const PS_SOURCE = psMain.toString();
const KILL_SOURCE = killMain.toString();
const SLEEP_SOURCE = sleepMain.toString();
const ULIMIT_SOURCE = ulimitMain.toString();
const SETFONT_SOURCE = setfontMain.toString();
const KEYMAP_SOURCE = keymapMain.toString();
const BASH_SOURCE = bashMain.toString();
const LOGIN_SOURCE = loginMain.toString();
const INIT_SOURCE = initMain.toString();
const REBOOT_SOURCE = rebootMain.toString();
const SNAPSHOT_SOURCE = snapshotMain.toString();

export const CAT_MANIFEST = JSON.stringify({
    name: "cat",
    syscalls: ["open", "read", "write", "close"],
});

export const ECHO_MANIFEST = JSON.stringify({
    name: "echo",
    syscalls: ["open", "write", "close"],
});

export const NANO_MANIFEST = JSON.stringify({
    name: "nano",
    syscalls: ["open", "read", "write", "close", "draw"],
});

export const BROWSER_MANIFEST = JSON.stringify({
    name: "browser",
    syscalls: ["draw"],
});

export const PING_MANIFEST = JSON.stringify({
    name: "ping",
    syscalls: ["udp_connect", "write"],
});

export const DESKTOP_MANIFEST = JSON.stringify({
    name: "desktop",
    syscalls: ["open", "read", "write", "close", "spawn"],
});

export const STARTX_MANIFEST = JSON.stringify({
    name: "startx",
    syscalls: ["open", "read", "write", "close", "spawn"],
});

export const LS_MANIFEST = JSON.stringify({
    name: "ls",
    syscalls: ["readdir", "write"],
});

export const MKDIR_MANIFEST = JSON.stringify({
    name: "mkdir",
    syscalls: ["mkdir", "write"],
});

export const RM_MANIFEST = JSON.stringify({
    name: "rm",
    syscalls: ["unlink", "write"],
});

export const MV_MANIFEST = JSON.stringify({
    name: "mv",
    syscalls: ["rename", "write"],
});

export const PS_MANIFEST = JSON.stringify({
    name: "ps",
    syscalls: ["ps", "write"],
});

export const KILL_MANIFEST = JSON.stringify({
    name: "kill",
    syscalls: ["kill", "jobs"],
});

export const SLEEP_MANIFEST = JSON.stringify({
    name: "sleep",
    syscalls: [],
});

export const ULIMIT_MANIFEST = JSON.stringify({
    name: "ulimit",
    syscalls: ["set_quota", "write"],
});

export const SETFONT_MANIFEST = JSON.stringify({
    name: "setfont",
    syscalls: ["open", "read", "write", "close", "mkdir"],
});

export const KEYMAP_MANIFEST = JSON.stringify({
    name: "keymap",
    syscalls: ["open", "read", "write", "close", "mkdir"],
});

export const BASH_MANIFEST = JSON.stringify({
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
});

export const LOGIN_MANIFEST = JSON.stringify({
    name: "login",
    syscalls: ["open", "read", "write", "close", "spawn"],
});

export const INIT_MANIFEST = JSON.stringify({
    name: "init",
    syscalls: ["open", "read", "write", "close", "spawn"],
});

export const REBOOT_MANIFEST = JSON.stringify({
    name: "reboot",
    syscalls: ["reboot"],
});

export const SNAPSHOT_MANIFEST = JSON.stringify({
    name: "snapshot",
    syscalls: [
        "snapshot",
        "save_snapshot_named",
        "load_snapshot_named",
        "reboot",
        "write",
    ],
});

export const BUNDLED_APPS = new Map<string, string>([
    ["nano", NANO_SOURCE],
    ["browser", BROWSER_SOURCE],
    ["ping", PING_SOURCE],
    ["desktop", DESKTOP_SOURCE],
    ["startx", STARTX_SOURCE],
    ["ls", LS_SOURCE],
    ["mkdir", MKDIR_SOURCE],
    ["rm", RM_SOURCE],
    ["mv", MV_SOURCE],
    ["ps", PS_SOURCE],
    ["kill", KILL_SOURCE],
    ["init", INIT_SOURCE],
    ["login", LOGIN_SOURCE],
    ["bash", BASH_SOURCE],
    ["setfont", SETFONT_SOURCE],
    ["keymap", KEYMAP_SOURCE],
    ["snapshot", SNAPSHOT_SOURCE],
    ["ulimit", ULIMIT_SOURCE],
]);

export {
    CAT_SOURCE,
    ECHO_SOURCE,
    NANO_SOURCE,
    BROWSER_SOURCE,
    PING_SOURCE,
    DESKTOP_SOURCE,
    STARTX_SOURCE,
    LS_SOURCE,
    MKDIR_SOURCE,
    RM_SOURCE,
    MV_SOURCE,
    PS_SOURCE,
    KILL_SOURCE,
    SLEEP_SOURCE,
    ULIMIT_SOURCE,
    SETFONT_SOURCE,
    KEYMAP_SOURCE,
    BASH_SOURCE,
    LOGIN_SOURCE,
    INIT_SOURCE,
    REBOOT_SOURCE,
    SNAPSHOT_SOURCE,
};
