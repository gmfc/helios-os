import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { XTerm } from '@pablo-lion/xterm-react';
import { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'react-resizable/css/styles.css';

import { Kernel } from '../core/kernel';
import { WindowManager, WindowManagerHandles } from './components/WindowManager';
import { eventBus, type DrawPayload } from '../core/eventBus';

// A basic theme for the terminal
const theme: ITheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  selectionBackground: 'rgba(255, 255, 255, 0.3)',
};

const App = () => {
    const xtermRef = useRef<XTerm>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const kernelRef = useRef<Kernel | null>(null);
    const windowManagerRef = useRef<WindowManagerHandles>(null);
    const [commandLine, setCommandLine] = useState('');
    const [isBusy, setIsBusy] = useState(false);

    useEffect(() => {
        let cleanup: (() => void) | undefined;

        Kernel.create().then(kernel => {
            kernelRef.current = kernel;
            kernel.start().catch(console.error);
        });

        const term = xtermRef.current?.terminal;
        if (term) {
            fitAddonRef.current = new FitAddon();
            term.loadAddon(fitAddonRef.current);
            
            setTimeout(() => handleResize(), 1);
            
            term.writeln('Welcome to Helios-OS Terminal');
            term.write('$ ');

            const originalLog = console.log;
            const originalError = console.error;

            const writeToTerminal = (data: any[], originalFunc: (...data: any[]) => void) => {
              const message = data.join(' ');
              const lines = message.split('\n');
              lines.forEach((line, index) => {
                term.write(line);
                if (index < lines.length - 1) {
                  term.write('\r\n');
                }
              });
              originalFunc.apply(console, data);
            }

            console.log = (...args: any[]) => writeToTerminal(args, originalLog);
            console.error = (...args: any[]) => writeToTerminal(args, originalError);

            cleanup = () => {
                console.log = originalLog;
                console.error = originalError;
            };
        }

        return () => {
            cleanup?.();
            kernelRef.current = null;
        };
    }, []);

    useEffect(() => {
        const handler = (payload: DrawPayload) => {
            windowManagerRef.current?.openWindow({
                id: payload.id,
                title: payload.opts.title,
                position: { x: payload.opts.x ?? 50, y: payload.opts.y ?? 50 },
                size: {
                    width: payload.opts.width ?? 400,
                    height: payload.opts.height ?? 300,
                },
                content: payload.html,
            });
        };

        eventBus.on('draw', handler);
        return () => eventBus.off('draw', handler);
    }, []);

    const handleResize = useCallback(() => {
        fitAddonRef.current?.fit();
    }, []);

    const onTerminalData = async (data: string) => {
        const term = xtermRef.current?.terminal;
        if (!term || isBusy) return;

        const code = data.charCodeAt(0);
        if (code === 13) { // Enter
            term.write('\r\n');
            const command = commandLine.trim();
            setCommandLine('');
            
            if (command) {
                setIsBusy(true);
                await kernelRef.current?.spawn(command);
                setIsBusy(false);
            }
            term.write('$ ');

        } else if (code === 127) { // Backspace
            if (commandLine.length > 0) {
                term.write('\b \b');
                setCommandLine(s => s.slice(0, -1));
            }
        } else if (code >= 32) { // Printable characters
            setCommandLine(s => s + data);
            term.write(data);
        }
    };

    return (
        <WindowManager ref={windowManagerRef} onResize={handleResize}>
            <XTerm
                ref={xtermRef}
                options={{ theme, cursorBlink: true, convertEol: true }}
                onData={onTerminalData}
            />
        </WindowManager>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = ReactDOM.createRoot(container);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
} 