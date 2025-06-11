import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import "react-resizable/css/styles.css";
import "@xterm/xterm/css/xterm.css";

import { WindowManager, WindowManagerHandles } from "./components/WindowManager";
import LoginPrompt from "./components/LoginPrompt";
import Terminal, { TerminalHandles } from "./components/Terminal";
import { useKernel } from "./hooks/useKernel";
import { eventBus, type DrawPayload } from "../core/utils/eventBus";
import { COLORS } from "./constants";

const App = () => {
    const { kernel, shellReady } = useKernel();
    const windowManagerRef = useRef<WindowManagerHandles>(null);
    const terminalRef = useRef<TerminalHandles>(null);
    const [loggedIn, setLoggedIn] = useState(false);
    const [loginError, setLoginError] = useState("");

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
                monitorId: payload.opts.monitorId ?? 0,
            });
        };
        eventBus.on("desktop.createWindow", handler);
        return () => eventBus.off("desktop.createWindow", handler);
    }, []);

    const handleResize = useCallback(() => {
        terminalRef.current?.fit();
    }, []);

    const handleLogin = useCallback(
        (user: string, pass: string) => {
            if (user === "user" && pass === "password") {
                kernel?.startNetworking();
                setLoggedIn(true);
                setLoginError("");
            } else {
                setLoginError("Invalid credentials");
            }
        },
        [kernel],
    );

    return (
        <WindowManager
            ref={windowManagerRef}
            onResize={handleResize}
            kernel={kernel}
        >
            {!shellReady ? (
                <div style={{ color: COLORS.foreground, padding: "10px" }}>
                    Booting...
                </div>
            ) : !loggedIn ? (
                <LoginPrompt onLogin={handleLogin} error={loginError} />
            ) : kernel ? (
                <Terminal ref={terminalRef} kernel={kernel} />
            ) : null}
        </WindowManager>
    );
};

const container = document.getElementById("root");
if (container) {
    const root = ReactDOM.createRoot(container);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    );
}
