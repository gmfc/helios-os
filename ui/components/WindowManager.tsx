import React, {
    useState,
    useImperativeHandle,
    forwardRef,
    useEffect,
} from "react";
import { Window } from "./Window";
import { eventBus } from "../../core/utils/eventBus";

export interface WindowState {
    id: number;
    title?: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    content: React.ReactNode;
    minimized?: boolean;
    maximized?: boolean;
    monitorId: number;
}

export interface Monitor {
    width: number;
    height: number;
    x: number;
    y: number;
}

export interface WindowManagerHandles {
    openWindow: (state: WindowState) => void;
    closeWindow: (id: number) => void;
}

interface WindowManagerProps {
    onResize?: () => void;
    children: React.ReactNode;
}

export const WindowManager = forwardRef<
    WindowManagerHandles,
    WindowManagerProps
>(({ onResize, children }, ref) => {
    const [monitors, setMonitors] = useState<Monitor[]>([
        { width: window.innerWidth, height: window.innerHeight, x: 0, y: 0 },
    ]);
    const [windows, setWindows] = useState<WindowState[]>([
        {
            id: 0,
            title: "Helios Terminal",
            position: { x: 50, y: 50 },
            size: { width: 700, height: 500 },
            content: children,
            minimized: false,
            maximized: false,
            monitorId: 0,
        },
    ]);
    const [focusedId, setFocusedId] = useState<number>(0);

    const openWindow = (state: WindowState) => {
        setWindows((w) => [
            ...w,
            { ...state, minimized: false, maximized: false, monitorId: state.monitorId ?? 0 },
        ]);
        setFocusedId(state.id);
    };

    const focusWindow = (id: number) => {
        setFocusedId(id);
        setWindows((w) => {
            const idx = w.findIndex((win) => win.id === id);
            if (idx === -1 || idx === w.length - 1) return w;
            const win = w[idx];
            return [...w.slice(0, idx), ...w.slice(idx + 1), win];
        });
    };

    const closeWindow = (id: number) => {
        setWindows((w) => w.filter((win) => win.id !== id));
    };

    const minimizeWindow = (id: number) => {
        setWindows((w) =>
            w.map((win) =>
                win.id === id ? { ...win, minimized: !win.minimized } : win,
            ),
        );
    };

    const toggleMaximizeWindow = (id: number) => {
        setWindows((w) =>
            w.map((win) =>
                win.id === id ? { ...win, maximized: !win.maximized } : win,
            ),
        );
    };

    const changeMonitor = (id: number, monitor: number) => {
        setWindows((w) =>
            w.map((win) =>
                win.id === id ? { ...win, monitorId: monitor } : win,
            ),
        );
    };

    const moveWindow = (id: number, position: { x: number; y: number }) => {
        setWindows((w) =>
            w.map((win) => (win.id === id ? { ...win, position } : win)),
        );
    };

    const resizeWindow = (id: number, size: { width: number; height: number }) => {
        setWindows((w) =>
            w.map((win) => (win.id === id ? { ...win, size } : win)),
        );
    };

    useEffect(() => {
        const handler = (list: Monitor[]) => setMonitors(list);
        eventBus.on("desktop.updateMonitors", handler);
        return () => eventBus.off("desktop.updateMonitors", handler);
    }, []);

    useImperativeHandle(ref, () => ({ openWindow, closeWindow }));

    useEffect(() => {
        let activeId: number | null = null;
        let startX = 0;
        let startY = 0;
        let startPos: { x: number; y: number } | null = null;
        let startSize: { width: number; height: number } | null = null;

        const getIdFromEvent = (e: MouseEvent) => {
            const el = (e.target as HTMLElement).closest("[data-window-id]");
            return el ? parseInt(el.getAttribute("data-window-id") || "", 10) : null;
        };

        const onMouseDown = (e: MouseEvent) => {
            if (e.altKey && e.button === 0) {
                const id = getIdFromEvent(e);
                if (id === null) return;
                activeId = id;
                const win = windows.find((w) => w.id === id);
                if (!win) return;
                startX = e.clientX;
                startY = e.clientY;
                startPos = win.position;
                e.preventDefault();
            } else if (e.altKey && e.button === 2) {
                const id = getIdFromEvent(e);
                if (id === null) return;
                activeId = id;
                const win = windows.find((w) => w.id === id);
                if (!win) return;
                startX = e.clientX;
                startY = e.clientY;
                startSize = win.size;
                e.preventDefault();
            }
        };

        const onMouseMove = (e: MouseEvent) => {
            if (activeId !== null) {
                if (startPos) {
                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;
                    const win = windows.find((w) => w.id === activeId);
                    if (!win) return;
                    let newX = startPos.x + dx;
                    let newY = startPos.y + dy;
                    const edge = 20;
                    const screenW = monitors.reduce((s,m)=>Math.max(s,m.x+m.width),0);
                    const screenH = Math.max(...monitors.map(m=>m.height));
                    if (e.clientX <= edge) newX = 0;
                    if (e.clientY <= edge) newY = 0;
                    if (e.clientX >= screenW - edge)
                        newX = screenW - win.size.width;
                    if (e.clientY >= screenH - edge)
                        newY = screenH - win.size.height;
                    moveWindow(activeId, { x: newX, y: newY });
                } else if (startSize) {
                    const dw = e.clientX - startX;
                    const dh = e.clientY - startY;
                    const win = windows.find((w) => w.id === activeId);
                    if (!win) return;
                    let newW = startSize.width + dw;
                    let newH = startSize.height + dh;
                    const edge = 20;
                    const screenW = monitors.reduce((s,m)=>Math.max(s,m.x+m.width),0);
                    const screenH = Math.max(...monitors.map(m=>m.height));
                    if (e.clientX >= screenW - edge)
                        newW = screenW - win.position.x;
                    if (e.clientY >= screenH - edge)
                        newH = screenH - win.position.y;
                    resizeWindow(activeId, {
                        width: Math.max(200, newW),
                        height: Math.max(150, newH),
                    });
                }
            }
        };

        const endMove = () => {
            activeId = null;
            startPos = null;
            startSize = null;
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (!e.metaKey) return;
            if (!focusedId) return;
            const win = windows.find((w) => w.id === focusedId);
            if (!win) return;
            const screenW = monitors.reduce((s,m)=>Math.max(s,m.x+m.width),0);
            const screenH = Math.max(...monitors.map(m=>m.height));
            let position = win.position;
            let size = win.size;
            switch (e.key) {
                case "ArrowLeft":
                    position = { x: 0, y: 0 };
                    size = { width: screenW / 2, height: screenH };
                    break;
                case "ArrowRight":
                    position = { x: screenW / 2, y: 0 };
                    size = { width: screenW / 2, height: screenH };
                    break;
                case "ArrowUp":
                    position = { x: 0, y: 0 };
                    size = { width: screenW, height: screenH / 2 };
                    break;
                case "ArrowDown":
                    position = { x: 0, y: screenH / 2 };
                    size = { width: screenW, height: screenH / 2 };
                    break;
                default:
                    return;
            }
            e.preventDefault();
            moveWindow(focusedId, position);
            resizeWindow(focusedId, size);
        };

        window.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", endMove);
        const contextHandler = (e: MouseEvent) => {
            if (activeId !== null && (startPos || startSize)) e.preventDefault();
        };
        window.addEventListener("contextmenu", contextHandler);
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", endMove);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("contextmenu", contextHandler);
        };
    }, [windows, focusedId]);

    return (
        <div
            className="window-manager-container"
            style={{ position: "relative", width: `${monitors.reduce((s,m)=>Math.max(s,m.x+m.width),0)}px`, height: `${Math.max(...monitors.map(m=>m.height))}px` }}
        >
            {windows.map((win, index) => (
                <Window
                    key={win.id}
                    id={win.id}
                    title={win.title ?? `Window ${win.id}`}
                    position={win.position}
                    size={win.size}
                    minimized={win.minimized}
                    maximized={win.maximized}
                    zIndex={index + 1}
                    onResize={(size) => resizeWindow(win.id, size)}
                    onMove={(pos) => moveWindow(win.id, pos)}
                    onFocus={focusWindow}
                    monitorId={win.monitorId}
                    monitors={monitors}
                    onChangeMonitor={(m) => changeMonitor(win.id, m)}
                    onClose={closeWindow}
                    onMinimize={() => minimizeWindow(win.id)}
                    onToggleMaximize={() => toggleMaximizeWindow(win.id)}
                >
                    {win.content}
                </Window>
            ))}
        </div>
    );
});

WindowManager.displayName = "WindowManager";
