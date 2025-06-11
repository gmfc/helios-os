import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import Draggable from "react-draggable";
import { ResizableBox } from "react-resizable";
import "./Window.css";
import type { Monitor } from "./WindowManager";
import { eventBus, type WindowMessagePayload } from "../../core/utils/eventBus";

export interface WindowProps {
    id: number;
    title: string;
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    minimized?: boolean;
    maximized?: boolean;
    onResize?: (size: { width: number; height: number }) => void;
    onMove?: (pos: { x: number; y: number }) => void;
    onFocus?: (id: number) => void;
    onClose?: (id: number) => void;
    onMinimize?: () => void;
    onToggleMaximize?: () => void;
    zIndex?: number;
    children: React.ReactNode;
    monitorId: number;
    monitors: Monitor[];
    onChangeMonitor?: (id: number) => void;
}

export interface WindowHandles {
    setPosition: (pos: { x: number; y: number }) => void;
    setSize: (size: { width: number; height: number }) => void;
}

export const Window = forwardRef<WindowHandles, WindowProps>(
    (
        {
            id,
            title,
            position = { x: 50, y: 50 },
            size = { width: 720, height: 500 },
            minimized,
            maximized,
            onResize,
            onMove,
            onFocus,
            onClose,
            onMinimize,
            onToggleMaximize,
            zIndex,
            children,
            monitorId,
            monitors,
            onChangeMonitor,
        },
        ref,
    ) => {
        const nodeRef = useRef<HTMLDivElement>(null);
        const [pos, setPos] = useState(position);
        const [dimensions, setDimensions] = useState(size);
        const prevPos = useRef(position);
        const prevSize = useRef(size);

        useImperativeHandle(ref, () => ({
            setPosition: (p) => setPos(p),
            setSize: (s) => setDimensions(s),
        }));

        useEffect(() => {
            setPos(position);
        }, [position]);

        useEffect(() => {
            setDimensions(size);
        }, [size]);

        useEffect(() => {
            if (maximized) {
                prevPos.current = pos;
                prevSize.current = dimensions;
                setPos({ x: 0, y: 0 });
                setDimensions({
                    width: window.innerWidth,
                    height: window.innerHeight,
                });
            } else if (maximized !== undefined) {
                setPos(prevPos.current);
                setDimensions(prevSize.current);
            }
        }, [maximized]);

        const iframeRef = useRef<HTMLIFrameElement>(null);

        useEffect(() => {
            const handler = (payload: WindowMessagePayload) => {
                if (payload.id === id) {
                    iframeRef.current?.contentWindow?.postMessage(payload.data, "*");
                }
            };
            eventBus.on("desktop.windowPost", handler);
            return () => eventBus.off("desktop.windowPost", handler);
        }, [id]);

        useEffect(() => {
            const listener = (e: MessageEvent) => {
                if (e.source === iframeRef.current?.contentWindow) {
                    eventBus.emit("desktop.windowRecv", { id, data: e.data });
                }
            };
            window.addEventListener("message", listener);
            return () => window.removeEventListener("message", listener);
        }, [id]);

        const content =
            typeof children === "string" ? (
            <iframe
                ref={iframeRef}
                srcDoc={children as string}
                sandbox="allow-scripts"
                style={{ width: "100%", height: "100%", border: "none" }}
            />
        ) : (
            children
        );

        const offset = monitors[monitorId] ?? { x: 0, y: 0 };
        const absPos = { x: pos.x + offset.x, y: pos.y + offset.y };

        return (
            <Draggable
                handle=".window-title-bar"
                position={absPos}
                bounds="parent"
                nodeRef={nodeRef}
                onStop={(e, data) => {
                    const rel = { x: data.x - offset.x, y: data.y - offset.y };
                    setPos(rel);
                    onMove?.(rel);
                }}
            >
                <div
                    ref={nodeRef}
                    style={{
                        position: "absolute",
                        zIndex,
                        display: minimized ? "none" : "block",
                    }}
                    data-window-id={id}
                    onMouseDown={() => onFocus?.(id)}
                >
                    <ResizableBox
                        width={dimensions.width}
                        height={dimensions.height}
                        onResizeStop={(e, { size: sz }) => {
                            setDimensions(sz);
                            onResize?.(sz);
                        }}
                        minConstraints={[400, 300]}
                        className="window-container"
                        handle={<span className="react-resizable-handle" />}
                    >
                        <div className="window-title-bar">
                            <div className="window-buttons">
                                <div
                                    className="window-button"
                                    onClick={() => onClose?.(id)}
                                />
                                <div
                                    className="window-button"
                                    onClick={onMinimize}
                                />
                                <div
                                    className="window-button"
                                    onClick={onToggleMaximize}
                                />
                            </div>
                            <div className="window-title">{title}</div>
                            <select
                                className="monitor-select"
                                value={monitorId}
                                onChange={(e) => onChangeMonitor?.(parseInt(e.target.value, 10))}
                                style={{ position: "absolute", right: 8 }}
                            >
                                {monitors.map((_, i) => (
                                    <option key={i} value={i}>{`M${i}`}</option>
                                ))}
                            </select>
                        </div>
                        <div className="window-content">{content}</div>
                    </ResizableBox>
                </div>
            </Draggable>
        );
    },
);

Window.displayName = "Window";
