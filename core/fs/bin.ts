/**
 * This file contains the source code for the initial binary programs
 * that will be loaded into the virtual file system.
 */
import { CAT_SOURCE } from "../../apps/cli/src/cat";
import { ECHO_SOURCE } from "../../apps/cli/src/echo";
import { NANO_SOURCE } from "../../apps/cli/src/nano";
import { BROWSER_SOURCE } from "../../apps/cli/src/browser";
import { PING_SOURCE } from "../../apps/cli/src/ping";
import { DESKTOP_SOURCE } from "../../apps/cli/src/desktop";
import { LS_SOURCE } from "../../apps/cli/src/ls";
import { MKDIR_SOURCE } from "../../apps/cli/src/mkdir";
import { RM_SOURCE } from "../../apps/cli/src/rm";
import { MV_SOURCE } from "../../apps/cli/src/mv";
import { PS_SOURCE } from "../../apps/cli/src/ps";
import { KILL_SOURCE } from "../../apps/cli/src/kill";
import { SLEEP_SOURCE } from "../../apps/cli/src/sleep";
import { ULIMIT_SOURCE } from "../../apps/cli/src/ulimit";
import { BASH_SOURCE } from "../../apps/cli/src/bash";
import { LOGIN_SOURCE } from "../../apps/cli/src/login";
import { INIT_SOURCE } from "../../apps/cli/src/init";
import { REBOOT_SOURCE } from "../../apps/cli/src/reboot";
import { SNAPSHOT_SOURCE } from "../../apps/cli/src/snapshot";

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
    syscalls: ["connect", "tcp_send", "write"],
});

export const DESKTOP_MANIFEST = JSON.stringify({
    name: "desktop",
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
    ["ls", LS_SOURCE],
    ["mkdir", MKDIR_SOURCE],
    ["rm", RM_SOURCE],
    ["mv", MV_SOURCE],
    ["ps", PS_SOURCE],
    ["kill", KILL_SOURCE],
    ["init", INIT_SOURCE],
    ["login", LOGIN_SOURCE],
    ["bash", BASH_SOURCE],
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
    LS_SOURCE,
    MKDIR_SOURCE,
    RM_SOURCE,
    MV_SOURCE,
    PS_SOURCE,
    KILL_SOURCE,
    SLEEP_SOURCE,
    ULIMIT_SOURCE,
    BASH_SOURCE,
    LOGIN_SOURCE,
    INIT_SOURCE,
    REBOOT_SOURCE,
    SNAPSHOT_SOURCE,
};
