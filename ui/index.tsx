import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { XTerm } from '@pablo-lion/xterm-react';
import { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'react-resizable/css/styles.css';
import '@xterm/xterm/css/xterm.css';

import { Kernel } from '../core/kernel';
import { WindowManager, WindowManagerHandles } from './components/WindowManager';
import LoginPrompt from './components/LoginPrompt';
import { eventBus, type DrawPayload } from '../core/utils/eventBus';

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
    const bootStartRef = useRef<number>(0);
    const windowManagerRef = useRef<WindowManagerHandles>(null);
    const [commandLine, setCommandLine] = useState('');
    const [isBusy, setIsBusy] = useState(false);
    const [shellReady, setShellReady] = useState(false);
    const [loggedIn, setLoggedIn] = useState(false);
    const [loginError, setLoginError] = useState('');

    const startKernel = useCallback(async () => {
        bootStartRef.current = performance.now();
        const kernel = await Kernel.create();
        kernelRef.current = kernel;
        kernel.start().catch(console.error);
    }, []);

    useEffect(() => {
        startKernel();

        return () => {
            kernelRef.current = null;
        };
    }, [startKernel]);

    useEffect(() => {
        const handler = () => {
            kernelRef.current?.stop();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, []);

    useEffect(() => {
        if (!shellReady || !loggedIn) return;
        let cleanup: (() => void) | undefined;

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
        };
    }, [shellReady, loggedIn]);

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

        eventBus.on('desktop.createWindow', handler);
        return () => eventBus.off('desktop.createWindow', handler);
    }, []);

    useEffect(() => {
        const handler = () => {
            const dur = performance.now() - bootStartRef.current;
            console.log(`Boot completed in ${Math.round(dur)} ms`);
            setShellReady(true);
        };
        eventBus.on('boot.shellReady', handler);
        return () => eventBus.off('boot.shellReady', handler);
    }, []);

    useEffect(() => {
        const handler = () => {
            setShellReady(false);
            setLoggedIn(false);
            startKernel();
        };
        eventBus.on('system.reboot', handler);
        return () => eventBus.off('system.reboot', handler);
    }, [startKernel]);

    const handleResize = useCallback(() => {
        fitAddonRef.current?.fit();
    }, []);

    const handleLogin = useCallback((user: string, pass: string) => {
        if (user === 'user' && pass === 'password') {
            kernelRef.current?.startNetworking();
            setLoggedIn(true);
            setLoginError('');
        } else {
            setLoginError('Invalid credentials');
        }
    }, []);

    const onTerminalData = async (data: string) => {
        const term = xtermRef.current?.terminal;
        if (!term || isBusy || !shellReady || !loggedIn) return;

        const code = data.charCodeAt(0);
        if (code === 13) { // Enter
            term.write('\r\n');
            const command = commandLine.trim();
            setCommandLine('');

            const isBg = command.endsWith('&');
            const cmd = isBg ? command.slice(0, -1).trim() : command;

            if (cmd) {
                if (!isBg) setIsBusy(true);
                await kernelRef.current?.spawn(cmd);
                if (!isBg) setIsBusy(false);
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
            {!shellReady ? (
                <div style={{ color: '#d4d4d4', padding: '10px' }}>Booting...</div>
            ) : !loggedIn ? (
                <LoginPrompt onLogin={handleLogin} error={loginError} />
            ) : (
                <XTerm
                    ref={xtermRef}
                    options={{ theme, cursorBlink: true, convertEol: true }}
                    onData={onTerminalData}
                />
            )}
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
