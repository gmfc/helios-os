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

    useEffect(() => {
        const term = xtermRef.current?.terminal;
        if (!term) return;

        fitAddonRef.current = new FitAddon();
        term.loadAddon(fitAddonRef.current);
        setTimeout(() => fitAddonRef.current?.fit(), 1);

        term.writeln("Welcome to Helios-OS Terminal");
        term.write("$ ");

        const originalLog = console.log;
        const originalError = console.error;
        const writeToTerminal = (data: any[], originalFunc: (...d: any[]) => void) => {
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
        console.log = (...args: any[]) => writeToTerminal(args, originalLog);
        console.error = (...args: any[]) => writeToTerminal(args, originalError);

        return () => {
            console.log = originalLog;
            console.error = originalError;
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
            options={{ theme: TERMINAL_THEME, cursorBlink: true, convertEol: true }}
            onData={onData}
        />
    );
});

export default Terminal;
