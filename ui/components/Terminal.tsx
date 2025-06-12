import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import { XTerm } from "@pablo-lion/xterm-react";
import { FitAddon } from "@xterm/addon-fit";
import { Kernel } from "../../core/kernel";
import { TERMINAL_THEME } from "../constants";
import { copyText, pasteText } from "../hooks/clipboard";

export interface TerminalHandles {
    fit: () => void;
}

interface TerminalProps {
    kernel: Kernel;
}

const Terminal = forwardRef<TerminalHandles, TerminalProps>(({ kernel }, ref) => {
    const xtermRef = useRef<XTerm>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [commandLine, setCommandLine] = useState("");
    const [isBusy, setIsBusy] = useState(false);
    const [fontFamily, setFontFamily] = useState("monospace");
    const [fontSize, setFontSize] = useState(14);
    const keymapRef = useRef<Record<string, number>>({});

    useEffect(() => {
        async function loadSettings() {
            try {
                const fs = (kernel as any).state.fs as any;
                const data: Uint8Array = await fs.read("/etc/input.json");
                const text = new TextDecoder().decode(data);
                const cfg = JSON.parse(text) as {
                    fontFamily?: string;
                    fontSize?: number;
                    keymap?: Record<string, number>;
                };
                if (cfg.fontFamily) setFontFamily(cfg.fontFamily);
                if (cfg.fontSize) setFontSize(cfg.fontSize);
                if (cfg.keymap) keymapRef.current = cfg.keymap;
            } catch {}
        }
        loadSettings();
    }, [kernel]);

    useEffect(() => {
        const term = xtermRef.current?.terminal;
        if (!term) return;

        fitAddonRef.current = new FitAddon();
        term.loadAddon(fitAddonRef.current);
        setTimeout(() => fitAddonRef.current?.fit(), 1);

        term.writeln("Welcome to Helios-OS Terminal");
        term.write("$ ");

        const selectionListener = term.onSelectionChange(() => {
            const sel = term.getSelection();
            if (sel) copyText(sel);
        });

        const contextHandler = async (e: MouseEvent) => {
            e.preventDefault();
            const text = await pasteText();
            if (text) term.paste(text);
        };
        term.element?.addEventListener("contextmenu", contextHandler);

        term.attachCustomKeyEventHandler((ev) => {
            if ((ev.ctrlKey || ev.metaKey) && ev.key === "v") {
                pasteText().then((text) => {
                    if (text) term.paste(text);
                });
                return false;
            }
            const code = keymapRef.current[ev.key];
            if (code) {
                term.write(String.fromCharCode(code));
                return false;
            }
            return true;
        });

        const originalLog = console.log;
        const originalError = console.error;
        const writeToTerminal = (data: unknown[], originalFunc: (...d: unknown[]) => void) => {
            const message = data.join(" ");
            const lines = message.split("\n");
            lines.forEach((line, index) => {
                term.write(line);
                if (index < lines.length - 1) {
                    term.write("\r\n");
                }
            });
            originalFunc.apply(console, data);
        };
        console.log = (...args: unknown[]) => writeToTerminal(args, originalLog);
        console.error = (...args: unknown[]) => writeToTerminal(args, originalError);

        return () => {
            console.log = originalLog;
            console.error = originalError;
            selectionListener.dispose();
            term.element?.removeEventListener("contextmenu", contextHandler);
        };
    }, []);

    const onData = async (data: string) => {
        const term = xtermRef.current?.terminal;
        if (!term || isBusy) return;
        const code = data.charCodeAt(0);
        if (code === 13) {
            term.write("\r\n");
            const command = commandLine.trim();
            setCommandLine("");
            const isBg = command.endsWith("&");
            const cmd = isBg ? command.slice(0, -1).trim() : command;
            if (cmd) {
                if (!isBg) setIsBusy(true);
                await kernel.spawn(cmd);
                if (!isBg) setIsBusy(false);
            }
            term.write("$ ");
        } else if (code === 127) {
            if (commandLine.length > 0) {
                term.write("\b \b");
                setCommandLine((s) => s.slice(0, -1));
            }
        } else if (code >= 32) {
            setCommandLine((s) => s + data);
            term.write(data);
        }
    };

    useImperativeHandle(ref, () => ({ fit: () => fitAddonRef.current?.fit() }));

    return (
        <XTerm
            ref={xtermRef}
            options={{
                theme: TERMINAL_THEME,
                cursorBlink: true,
                convertEol: true,
                fontFamily,
                fontSize,
            }}
            onData={onData}
        />
    );
});

Terminal.displayName = "Terminal";

export default Terminal;
