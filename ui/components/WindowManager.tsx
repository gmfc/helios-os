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

  const closeWindow = (id: number) => {
    setWindows(w => w.filter(win => win.id !== id));
  };

  useImperativeHandle(ref, () => ({ openWindow, closeWindow }));

  return (
    <div className="window-manager-container" style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      {windows.map(win => (
        <Window
          key={win.id}
          title={win.title ?? `Window ${win.id}`}
          initialPosition={win.position}
          initialSize={win.size}
          onResize={win.id === 0 ? onResize : undefined}
        >
          {typeof win.content === 'string' ? (
            <div dangerouslySetInnerHTML={{ __html: win.content as string }} />
          ) : (
            win.content
          )}
        </Window>
      ))}
    </div>
  );
});
