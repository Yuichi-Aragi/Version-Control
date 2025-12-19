import { 
  type FC, 
  useEffect, 
  useRef, 
  useState, 
  useLayoutEffect, 
  useCallback,
  useMemo
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { produce } from 'immer';
import { clamp, throttle } from 'es-toolkit';
import * as v from 'valibot';
import { useAppDispatch } from '@/ui/hooks';
import { appSlice } from '@/state';
import { DiffPanel } from './DiffPanel';
import type { DiffPanel as DiffPanelState } from '@/state';
import { Icon } from '@/ui/components';

// ==================== VALIDATION SCHEMAS ====================
const RectSchema = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number()
});

const ResizeDirectionSchema = v.object({
  x: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(-1),
    v.maxValue(1)
  ),
  y: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(-1),
    v.maxValue(1)
  )
});

type Rect = v.InferOutput<typeof RectSchema>;
type ResizeDirection = v.InferOutput<typeof ResizeDirectionSchema>;

// ==================== CONSTANTS & CONFIG ====================
const MIN_WINDOW_WIDTH = 300;
const MIN_WINDOW_HEIGHT = 200;
const MAX_WINDOW_WIDTH_MULTIPLIER = 0.95;
const MAX_WINDOW_HEIGHT_MULTIPLIER = 0.90;
const SMALL_SCREEN_BREAKPOINT = 768;
const DEFAULT_DESKTOP_WIDTH = 800;
const DEFAULT_DESKTOP_HEIGHT = 600;
const DRAG_THROTTLE_INTERVAL_MS = 16; // ~60fps
const RESIZE_THROTTLE_INTERVAL_MS = 16;
const Z_INDEX_WINDOW = 9999;
const Z_INDEX_GHOST = 10000;

// ==================== UTILITY FUNCTIONS ====================
const validateRect = (rect: unknown): Rect => {
  try {
    return v.parse(RectSchema, rect);
  } catch {
    return { x: 0, y: 0, width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT };
  }
};

const validateResizeDirection = (dir: unknown): ResizeDirection => {
  try {
    return v.parse(ResizeDirectionSchema, dir);
  } catch {
    return { x: 1, y: 1 };
  }
};

const getViewportDimensions = (): { width: number; height: number } => ({
  width: window.innerWidth,
  height: window.innerHeight
});

const calculateMinDimensions = (viewportWidth: number, viewportHeight: number): { width: number; height: number } => ({
  width: Math.min(MIN_WINDOW_WIDTH, viewportWidth * 0.8),
  height: Math.min(MIN_WINDOW_HEIGHT, viewportHeight * 0.8)
});

const calculateMaxDimensions = (viewportWidth: number, viewportHeight: number): { width: number; height: number } => ({
  width: viewportWidth * MAX_WINDOW_WIDTH_MULTIPLIER,
  height: viewportHeight * MAX_WINDOW_HEIGHT_MULTIPLIER
});

const clampRectToViewport = (rect: Rect): Rect => {
  const viewport = getViewportDimensions();
  const minDims = calculateMinDimensions(viewport.width, viewport.height);
  const maxDims = calculateMaxDimensions(viewport.width, viewport.height);
  
  return produce(rect, (draft) => {
    // Clamp dimensions first
    draft.width = clamp(draft.width, minDims.width, maxDims.width);
    draft.height = clamp(draft.height, minDims.height, maxDims.height);
    
    // Clamp position ensuring window stays within viewport
    const maxX = viewport.width - draft.width;
    const maxY = viewport.height - draft.height;
    
    draft.x = clamp(draft.x, 0, maxX);
    draft.y = clamp(draft.y, 0, maxY);
  });
};

const calculateInitialRect = (): Rect => {
  const viewport = getViewportDimensions();
  const isSmallScreen = viewport.width < SMALL_SCREEN_BREAKPOINT;
  
  const targetWidth = isSmallScreen 
    ? viewport.width * 0.95 
    : Math.min(DEFAULT_DESKTOP_WIDTH, viewport.width * 0.9);
    
  const targetHeight = isSmallScreen 
    ? viewport.height * 0.85 
    : Math.min(DEFAULT_DESKTOP_HEIGHT, viewport.height * 0.85);
  
  const width = clamp(targetWidth, MIN_WINDOW_WIDTH, viewport.width * MAX_WINDOW_WIDTH_MULTIPLIER);
  const height = clamp(targetHeight, MIN_WINDOW_HEIGHT, viewport.height * MAX_WINDOW_HEIGHT_MULTIPLIER);
  
  const x = Math.max(0, (viewport.width - width) / 2);
  const y = Math.max(0, (viewport.height - height) / 2);
  
  return validateRect({ x, y, width, height });
};

const getResizeDirection = (
  clickX: number,
  clickY: number,
  windowWidth: number,
  windowHeight: number
): ResizeDirection => {
  const xThresh1 = windowWidth / 3;
  const xThresh2 = (windowWidth * 2) / 3;
  const yThresh1 = windowHeight / 3;
  const yThresh2 = (windowHeight * 2) / 3;
  
  let dirX: -1 | 0 | 1 = 0;
  if (clickX < xThresh1) dirX = -1;
  else if (clickX > xThresh2) dirX = 1;
  
  let dirY: -1 | 0 | 1 = 0;
  if (clickY < yThresh1) dirY = -1;
  else if (clickY > yThresh2) dirY = 1;
  
  // Default to bottom-right if clicked dead center
  if (dirX === 0 && dirY === 0) {
    dirX = 1;
    dirY = 1;
  }
  
  return validateResizeDirection({ x: dirX, y: dirY });
};

// ==================== CUSTOM HOOKS ====================
const useViewportClamp = (rect: Rect, setRect: (rect: Rect) => void) => {
  useEffect(() => {
    const handleResize = () => {
      setRect(clampRectToViewport(rect));
    };
    
    const throttledResize = throttle(handleResize, 100);
    window.addEventListener('resize', throttledResize);
    
    return () => {
      window.removeEventListener('resize', throttledResize);
      throttledResize.cancel();
    };
  }, [rect, setRect]);
};

const usePointerCapture = (
  elementRef: React.RefObject<HTMLElement | null>,
  onPointerDown: (e: React.PointerEvent) => boolean,
  onPointerMove: (e: React.PointerEvent) => void,
  onPointerUp: (e: React.PointerEvent) => void
) => {
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only capture if the handler returns true.
    // This allows default behavior (bubbling, clicks) when not dragging/resizing.
    if (onPointerDown(e)) {
      elementRef.current?.setPointerCapture(e.pointerId);
    }
  }, [elementRef, onPointerDown]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (elementRef.current?.hasPointerCapture(e.pointerId)) {
      elementRef.current?.releasePointerCapture(e.pointerId);
    }
    onPointerUp(e);
  }, [elementRef, onPointerUp]);

  return {
    onPointerDown: handlePointerDown,
    onPointerMove,
    onPointerUp: handlePointerUp
  };
};

// ==================== MAIN COMPONENT ====================
interface DiffWindowProps {
  panelState: DiffPanelState;
}

export const DiffWindow: FC<DiffWindowProps> = ({ panelState }) => {
  const dispatch = useAppDispatch();
  const windowRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // State managed with validation
  const [rect, setRect] = useState<Rect>(() => calculateInitialRect());
  const [isResizeMode, setIsResizeMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [ghostRect, setGhostRect] = useState<Rect | null>(null);

  // Refs for state that shouldn't trigger re-renders
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const initialRectRef = useRef<Rect | null>(null);
  const resizeDirRef = useRef<ResizeDirection>({ x: 1, y: 1 });

  // Apply viewport clamping on mount and when rect changes
  useViewportClamp(rect, setRect);

  // Initial positioning - only once on mount
  useLayoutEffect(() => {
    setRect(calculateInitialRect());
  }, []);

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // ==================== EVENT HANDLERS ====================
  const handleClose = useCallback(() => {
    dispatch(appSlice.actions.closePanel());
  }, [dispatch]);

  const handleToggleResizeMode = useCallback(() => {
    setIsResizeMode(prev => !prev);
    // Reset interacting states when toggling off
    if (isResizeMode) {
      setIsDragging(false);
      setIsResizing(false);
      setGhostRect(null);
    }
  }, [isResizeMode]);

  // --- Move Logic (Header Drag) ---
  const handleHeaderPointerDown = useCallback((e: React.PointerEvent): boolean => {
    if (isResizeMode) return false;
    if ((e.target as HTMLElement).closest('button')) return false;

    e.preventDefault();
    e.stopPropagation();
    
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    initialRectRef.current = { ...rect };
    
    return true; // Capture pointer
  }, [isResizeMode, rect]);

  const throttledHeaderMove = useMemo(() => 
    throttle((e: React.PointerEvent) => {
      if (!isDragging || !dragStartRef.current || !initialRectRef.current) return;
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      animationFrameRef.current = requestAnimationFrame(() => {
        const viewport = getViewportDimensions();
        const dx = e.clientX - dragStartRef.current!.x;
        const dy = e.clientY - dragStartRef.current!.y;
        
        const newX = clamp(
          initialRectRef.current!.x + dx,
          0,
          viewport.width - initialRectRef.current!.width
        );
        
        const newY = clamp(
          initialRectRef.current!.y + dy,
          0,
          viewport.height - initialRectRef.current!.height
        );
        
        setRect(prev => validateRect({ ...prev, x: newX, y: newY }));
      });
    }, DRAG_THROTTLE_INTERVAL_MS),
    [isDragging]
  );

  const handleHeaderPointerUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    dragStartRef.current = null;
    initialRectRef.current = null;
  }, [isDragging]);

  // --- Resize Logic ---
  const handleModalPointerDown = useCallback((e: React.PointerEvent): boolean => {
    if (!isResizeMode) return false;
    
    e.preventDefault();
    e.stopPropagation();
    
    const clickX = e.clientX - rect.x;
    const clickY = e.clientY - rect.y;
    
    const direction = getResizeDirection(clickX, clickY, rect.width, rect.height);
    resizeDirRef.current = direction;
    
    setIsResizing(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    initialRectRef.current = { ...rect };
    setGhostRect({ ...rect });

    return true; // Capture pointer
  }, [isResizeMode, rect]);

  const throttledModalMove = useMemo(() => 
    throttle((e: React.PointerEvent) => {
      if (!isResizing || !dragStartRef.current || !initialRectRef.current) return;
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      animationFrameRef.current = requestAnimationFrame(() => {
        const viewport = getViewportDimensions();
        const dx = e.clientX - dragStartRef.current!.x;
        const dy = e.clientY - dragStartRef.current!.y;
        const dir = resizeDirRef.current;
        const initial = initialRectRef.current!;
        
        let newX = initial.x;
        let newY = initial.y;
        let newWidth = initial.width;
        let newHeight = initial.height;
        
        // Horizontal resizing
        if (dir.x === 1) {
          newWidth = clamp(initial.width + dx, MIN_WINDOW_WIDTH, viewport.width - initial.x);
        } else if (dir.x === -1) {
          const maxWidthChange = initial.x; // Can't move left beyond viewport
          const clampedDx = clamp(dx, -maxWidthChange, initial.width - MIN_WINDOW_WIDTH);
          newWidth = initial.width - clampedDx;
          newX = initial.x + clampedDx;
        }
        
        // Vertical resizing
        if (dir.y === 1) {
          newHeight = clamp(initial.height + dy, MIN_WINDOW_HEIGHT, viewport.height - initial.y);
        } else if (dir.y === -1) {
          const maxHeightChange = initial.y;
          const clampedDy = clamp(dy, -maxHeightChange, initial.height - MIN_WINDOW_HEIGHT);
          newHeight = initial.height - clampedDy;
          newY = initial.y + clampedDy;
        }
        
        // Boundary constraints
        if (newX < 0) {
          newWidth += newX; // Reduce width by overflow amount
          newX = 0;
        }
        
        if (newY < 0) {
          newHeight += newY;
          newY = 0;
        }
        
        if (newX + newWidth > viewport.width) {
          newWidth = viewport.width - newX;
        }
        
        if (newY + newHeight > viewport.height) {
          newHeight = viewport.height - newY;
        }
        
        // Final dimension clamping
        newWidth = clamp(newWidth, MIN_WINDOW_WIDTH, viewport.width);
        newHeight = clamp(newHeight, MIN_WINDOW_HEIGHT, viewport.height);
        
        const newRect = validateRect({
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight
        });
        
        setGhostRect(newRect);
      });
    }, RESIZE_THROTTLE_INTERVAL_MS),
    [isResizing]
  );

  const handleModalPointerUp = useCallback(() => {
    if (!isResizing) return;
    
    setIsResizing(false);
    dragStartRef.current = null;
    initialRectRef.current = null;
    
    if (ghostRect) {
      setRect(ghostRect);
      setGhostRect(null);
    }
  }, [isResizing, ghostRect]);

  // Setup pointer capture for both drag and resize
  const headerPointerEvents = usePointerCapture(
    headerRef,
    handleHeaderPointerDown,
    throttledHeaderMove,
    handleHeaderPointerUp
  );

  const modalPointerEvents = usePointerCapture(
    windowRef,
    handleModalPointerDown,
    throttledModalMove,
    handleModalPointerUp
  );

  // ==================== RENDER ====================
  return createPortal(
    <>
      <div 
        ref={windowRef}
        className={clsx('v-diff-window', { 
          'is-resize-mode': isResizeMode, 
          'is-dragging': isDragging,
          'is-resizing': isResizing
        })}
        style={{
          transform: `translate(${rect.x}px, ${rect.y}px)`,
          width: rect.width,
          height: rect.height,
          zIndex: Z_INDEX_WINDOW
        }}
        {...modalPointerEvents}
        role="dialog"
        aria-modal="true"
        aria-label="Diff View Window"
      >
        <div 
          ref={headerRef} 
          className="v-diff-window-header"
          {...headerPointerEvents}
          aria-label="Window header, drag to move"
        >
          <div className="v-diff-window-title">Diff View</div>
          <div className="v-diff-window-controls">
            <button 
              className={clsx("clickable-icon", { "is-active": isResizeMode })}
              onClick={handleToggleResizeMode}
              title={isResizeMode ? "Finish resizing" : "Resize window"}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={isResizeMode ? "Exit resize mode" : "Enter resize mode"}
              aria-pressed={isResizeMode}
              type="button"
            >
              <Icon name={isResizeMode ? "check" : "move-diagonal"} />
            </button>
            <button 
              className="clickable-icon"
              onClick={handleClose}
              title="Close window"
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Close window"
              type="button"
            >
              <Icon name="x" />
            </button>
          </div>
        </div>
        
        <div className="v-diff-window-gap" />
        
        <div className="v-diff-window-content">
          <DiffPanel panelState={panelState} />
        </div>

        {isResizeMode && (
          <div 
            className="v-resize-overlay" 
            role="region"
            aria-label="Resize overlay - click and drag edges to resize"
          />
        )}
      </div>

      {ghostRect && (
        <div 
          className="v-diff-window-ghost"
          style={{
            transform: `translate(${ghostRect.x}px, ${ghostRect.y}px)`,
            width: ghostRect.width,
            height: ghostRect.height,
            zIndex: Z_INDEX_GHOST
          }}
          aria-hidden="true"
        />
      )}
    </>,
    document.body
  );
};
