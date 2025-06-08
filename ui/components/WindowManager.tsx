import React, { useState, useImperativeHandle, forwardRef } from 'react';
import { Window } from './Window';

export interface WindowState {
  id: number;
  title?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  content: React.ReactNode;
}

export interface WindowManagerHandles {
  openWindow: (state: WindowState) => void;
  closeWindow: (id: number) => void;
}

interface WindowManagerProps {
  onResize?: () => void;
  children: React.ReactNode;
}

export const WindowManager = forwardRef<WindowManagerHandles, WindowManagerProps>(({ onResize, children }, ref) => {
  const [windows, setWindows] = useState<WindowState[]>([
    {
      id: 0,
      title: 'Helios Terminal',
      position: { x: 50, y: 50 },
      size: { width: 700, height: 500 },
      content: children,
    },
  ]);

  const openWindow = (state: WindowState) => {
    setWindows(w => [...w, state]);
  };

  const focusWindow = (id: number) => {
    setWindows(w => {
      const idx = w.findIndex(win => win.id === id);
      if (idx === -1 || idx === w.length - 1) return w;
      const win = w[idx];
      return [...w.slice(0, idx), ...w.slice(idx + 1), win];
    });
  };

  const closeWindow = (id: number) => {
    setWindows(w => w.filter(win => win.id !== id));
  };

  useImperativeHandle(ref, () => ({ openWindow, closeWindow }));

  return (
    <div className="window-manager-container" style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      {windows.map((win, index) => (
        <Window
          key={win.id}
          id={win.id}
          title={win.title ?? `Window ${win.id}`}
          initialPosition={win.position}
          initialSize={win.size}
          zIndex={index + 1}
          onResize={win.id === 0 ? onResize : undefined}
          onFocus={focusWindow}
        >
          {win.content}
        </Window>
      ))}
    </div>
  );
});
