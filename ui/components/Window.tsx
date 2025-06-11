import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import Draggable from "react-draggable";
import { ResizableBox } from "react-resizable";
import "./Window.css";

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

        const content =
            typeof children === "string" ? (
            <iframe
                srcDoc={children as string}
                sandbox="allow-scripts"
                style={{ width: "100%", height: "100%", border: "none" }}
            />
        ) : (
            children
        );

        return (
            <Draggable
                handle=".window-title-bar"
                position={pos}
                bounds="parent"
                nodeRef={nodeRef}
                onStop={(e, data) => {
                    const newPos = { x: data.x, y: data.y };
                    setPos(newPos);
                    onMove?.(newPos);
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
                        </div>
                        <div className="window-content">{content}</div>
                    </ResizableBox>
                </div>
            </Draggable>
        );
    },
);

Window.displayName = "Window";
