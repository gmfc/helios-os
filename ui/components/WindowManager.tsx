import React from 'react';
import { Window } from './Window';

interface WindowManagerProps {
  onResize?: () => void;
  children: React.ReactNode;
}

export const WindowManager: React.FC<WindowManagerProps> = ({ onResize, children }) => {
  return (
    <div className="window-manager-container" style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <Window
        title="Helios Terminal"
        initialPosition={{ x: 50, y: 50 }}
        initialSize={{ width: 700, height: 500 }}
        onResize={onResize}
      >
        {children}
      </Window>
      {/* In the future, this component would map over a list of window states to render multiple windows */}
    </div>
  );
}; 