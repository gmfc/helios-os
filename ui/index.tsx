import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { XTerm } from '@pablo-lion/xterm-react';
import { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'react-resizable/css/styles.css';

import { Kernel } from '../core/kernel';
import { WindowManager } from './components/WindowManager';

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
    const [commandLine, setCommandLine] = useState('');
    const [isBusy, setIsBusy] = useState(false);

    useEffect(() => {
        Kernel.create().then(kernel => {
            kernelRef.current = kernel;
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

            return () => {
                console.log = originalLog;
                console.error = originalError;
            };
        }
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
        <WindowManager onResize={handleResize}>
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