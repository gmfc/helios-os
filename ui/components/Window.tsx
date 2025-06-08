import React, { useRef } from 'react';
import Draggable from 'react-draggable';
import { ResizableBox } from 'react-resizable';
import './Window.css';

interface WindowProps {
  id: number;
  title: string;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  onResize?: (size: { width: number, height: number }) => void;
  onFocus?: (id: number) => void;
  zIndex?: number;
  children: React.ReactNode;
}

export const Window: React.FC<WindowProps> = ({
  id,
  title,
  initialPosition = { x: 50, y: 50 },
  initialSize = { width: 720, height: 500 },
  onResize,
  onFocus,
  zIndex,
  children,
}) => {
  const nodeRef = useRef(null);
  const content =
    typeof children === 'string' ? (
      <iframe
        srcDoc={children as string}
        sandbox="allow-scripts"
        style={{ width: '100%', height: '100%', border: 'none' }}
      />
    ) : (
      children
    );

  return (
    <Draggable
      handle=".window-title-bar"
      defaultPosition={initialPosition}
      bounds="parent"
      nodeRef={nodeRef}
    >
      <div
        ref={nodeRef}
        style={{ position: 'absolute', zIndex }}
        onMouseDown={() => onFocus?.(id)}
      >
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
          <div className="window-content">{content}</div>
        </ResizableBox>
      </div>
    </Draggable>
  );
};
