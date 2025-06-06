import React, { useRef } from 'react';
import Draggable from 'react-draggable';
import { ResizableBox } from 'react-resizable';
import './Window.css';

interface WindowProps {
  title: string;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  onResize?: (size: { width: number, height: number }) => void;
  children: React.ReactNode;
}

export const Window: React.FC<WindowProps> = ({
  title,
  initialPosition = { x: 50, y: 50 },
  initialSize = { width: 720, height: 500 },
  onResize,
  children,
}) => {
  const nodeRef = useRef(null);

  return (
    <Draggable
      handle=".window-title-bar"
      defaultPosition={initialPosition}
      bounds="parent"
      nodeRef={nodeRef}
    >
      <div ref={nodeRef} style={{ position: 'absolute' }}>
        <ResizableBox
          width={initialSize.width}
          height={initialSize.height}
          onResize={(e, { size }) => onResize?.(size)}
          minConstraints={[400, 300]}
          className="window-container"
          handle={<span className="react-resizable-handle" />}
        >
          <div className="window-title-bar">
            <div className="window-buttons">
              <div className="window-button" />
              <div className="window-button" />
              <div className="window-button" />
            </div>
            <div className="window-title">{title}</div>
          </div>
          <div className="window-content">
            {children}
          </div>
        </ResizableBox>
      </div>
    </Draggable>
  );
}; 