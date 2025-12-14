import { type FC, useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useAppDispatch } from '@/ui/hooks';
import { appSlice } from '@/state';
import { DiffPanel } from './DiffPanel';
import type { DiffPanel as DiffPanelState } from '@/state';
import { Icon } from '@/ui/components';

interface DiffWindowProps {
    panelState: DiffPanelState;
}

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface ResizeDirection {
    x: -1 | 0 | 1; // -1: Left, 0: Center, 1: Right
    y: -1 | 0 | 1; // -1: Top, 0: Center, 1: Bottom
}

export const DiffWindow: FC<DiffWindowProps> = ({ panelState }) => {
    const dispatch = useAppDispatch();
    const windowRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);

    // Initial state
    const [rect, setRect] = useState<Rect>({
        x: 0,
        y: 0,
        width: 600,
        height: 500
    });

    const [isResizeMode, setIsResizeMode] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    
    // For ghost outline during resize
    const [ghostRect, setGhostRect] = useState<Rect | null>(null);

    // Refs for drag/resize calculations
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    const initialRectRef = useRef<Rect | null>(null);
    const resizeDirRef = useRef<ResizeDirection>({ x: 1, y: 1 });

    // Helper to clamp rect to viewport boundaries
    const clampToViewport = useCallback((r: Rect) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        
        // 1. Clamp dimensions to viewport
        const width = Math.min(r.width, vw);
        const height = Math.min(r.height, vh);

        // 2. Clamp position
        let x = r.x;
        let y = r.y;

        // If right edge is off screen, shift left
        if (x + width > vw) x = vw - width;
        // If bottom edge is off screen, shift up
        if (y + height > vh) y = vh - height;
        
        // If left/top is off screen (e.g. after shift), clamp to 0
        x = Math.max(0, x);
        y = Math.max(0, y);

        return { x, y, width, height };
    }, []);

    // Handle Viewport Resize (Orientation change, Window resize)
    useEffect(() => {
        const handleViewportResize = () => {
            setRect(prev => clampToViewport(prev));
        };
        
        window.addEventListener('resize', handleViewportResize);
        return () => window.removeEventListener('resize', handleViewportResize);
    }, [clampToViewport]);

    // Initial Positioning
    useLayoutEffect(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        
        // Responsive defaults
        const isSmallScreen = vw < 768; // Mobile/Tablet breakpoint
        
        // On small screens, take up most of the view. On desktop, use a sensible default.
        let targetW = isSmallScreen ? vw * 0.95 : 800;
        let targetH = isSmallScreen ? vh * 0.85 : 600;

        const width = Math.min(targetW, vw);
        const height = Math.min(targetH, vh);
        
        const x = (vw - width) / 2;
        const y = (vh - height) / 2;

        setRect({ x, y, width, height });
    }, []);

    const handleClose = useCallback(() => {
        dispatch(appSlice.actions.closePanel());
    }, [dispatch]);

    const handleToggleResizeMode = useCallback(() => {
        setIsResizeMode(prev => !prev);
        // Reset interacting states if toggling off
        setIsDragging(false);
        setIsResizing(false);
        setGhostRect(null);
    }, []);

    // --- Move Logic (Header Drag) using Pointer Events ---
    const handleHeaderPointerDown = (e: React.PointerEvent) => {
        if (isResizeMode) return; // Disable move in resize mode
        if ((e.target as HTMLElement).closest('button')) return; // Ignore button clicks

        e.preventDefault();
        e.stopPropagation();
        
        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture(e.pointerId);

        setIsDragging(true);
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        initialRectRef.current = { ...rect };
    };

    const handleHeaderPointerMove = (e: React.PointerEvent) => {
        if (!isDragging || !dragStartRef.current || !initialRectRef.current) return;
        e.preventDefault();

        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;

        const newX = initialRectRef.current.x + dx;
        const newY = initialRectRef.current.y + dy;

        // Boundary checks: Ensure window stays strictly within viewport
        const maxX = window.innerWidth - initialRectRef.current.width;
        const maxY = window.innerHeight - initialRectRef.current.height;

        setRect(prev => ({
            ...prev,
            x: Math.max(0, Math.min(newX, maxX)),
            y: Math.max(0, Math.min(newY, maxY))
        }));
    };

    const handleHeaderPointerUp = (e: React.PointerEvent) => {
        if (!isDragging) return;
        setIsDragging(false);
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    };

    // --- Resize Logic (Modal Drag) using Pointer Events ---
    const handleModalPointerDown = (e: React.PointerEvent) => {
        if (!isResizeMode) return;
        
        e.preventDefault();
        e.stopPropagation(); // Prevent interaction with content
        
        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture(e.pointerId);

        // Determine resize direction based on click position relative to window
        const clickX = e.clientX - rect.x;
        const clickY = e.clientY - rect.y;
        const { width, height } = rect;

        // Define zones (3x3 grid)
        const xThresh1 = width / 3;
        const xThresh2 = (width * 2) / 3;
        const yThresh1 = height / 3;
        const yThresh2 = (height * 2) / 3;

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

        resizeDirRef.current = { x: dirX, y: dirY };
        setIsResizing(true);
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        initialRectRef.current = { ...rect };
        setGhostRect({ ...rect });
    };

    const handleModalPointerMove = (e: React.PointerEvent) => {
        if (!isResizing || !dragStartRef.current || !initialRectRef.current) return;
        e.preventDefault();

        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        const dir = resizeDirRef.current;
        const initial = initialRectRef.current;

        // Calculate potential new dimensions and position
        let newWidth = initial.width;
        let newHeight = initial.height;
        let newX = initial.x;
        let newY = initial.y;

        // Horizontal resizing
        if (dir.x === 1) { // Right edge
            newWidth = initial.width + dx;
        } else if (dir.x === -1) { // Left edge
            newWidth = initial.width - dx;
            newX = initial.x + dx;
        }

        // Vertical resizing
        if (dir.y === 1) { // Bottom edge
            newHeight = initial.height + dy;
        } else if (dir.y === -1) { // Top edge
            newHeight = initial.height - dy;
            newY = initial.y + dy;
        }

        // Apply Constraints
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const minWidth = Math.min(300, vw);
        const minHeight = Math.min(200, vh);

        // 1. Min Size Constraints
        if (newWidth < minWidth) {
            // If resizing left, we need to adjust X back
            if (dir.x === -1) {
                newX = initial.x + initial.width - minWidth;
            }
            newWidth = minWidth;
        }
        if (newHeight < minHeight) {
            // If resizing top, we need to adjust Y back
            if (dir.y === -1) {
                newY = initial.y + initial.height - minHeight;
            }
            newHeight = minHeight;
        }

        // 2. Viewport Boundary Constraints
        // Left boundary
        if (newX < 0) {
            if (dir.x === -1) {
                // If dragging left edge off screen, cap width
                newWidth += newX; // newX is negative, so this reduces width
            }
            newX = 0;
        }
        // Top boundary
        if (newY < 0) {
            if (dir.y === -1) {
                newHeight += newY;
            }
            newY = 0;
        }
        // Right boundary
        if (newX + newWidth > vw) {
            if (dir.x === 1) {
                newWidth = vw - newX;
            } else {
                // If moving right (via left resize?) shouldn't happen with logic above
                // but strictly:
                newX = vw - newWidth;
            }
        }
        // Bottom boundary
        if (newY + newHeight > vh) {
            if (dir.y === 1) {
                newHeight = vh - newY;
            } else {
                newY = vh - newHeight;
            }
        }

        setGhostRect({
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight
        });
    };

    const handleModalPointerUp = (e: React.PointerEvent) => {
        if (!isResizing) return;
        setIsResizing(false);
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        
        if (ghostRect) {
            setRect(ghostRect);
            setGhostRect(null);
        }
    };

    return createPortal(
        <>
            <div 
                ref={windowRef}
                className={clsx('v-diff-window', { 'is-resize-mode': isResizeMode, 'is-dragging': isDragging })}
                style={{
                    transform: `translate(${rect.x}px, ${rect.y}px)`,
                    width: rect.width,
                    height: rect.height,
                    zIndex: 9999
                }}
                onPointerDown={handleModalPointerDown}
                onPointerMove={handleModalPointerMove}
                onPointerUp={handleModalPointerUp}
            >
                <div 
                    ref={headerRef} 
                    className="v-diff-window-header"
                    onPointerDown={handleHeaderPointerDown}
                    onPointerMove={handleHeaderPointerMove}
                    onPointerUp={handleHeaderPointerUp}
                >
                    <div className="v-diff-window-title">Diff View</div>
                    <div className="v-diff-window-controls">
                        <button 
                            className={clsx("clickable-icon", { "is-active": isResizeMode })}
                            onClick={handleToggleResizeMode}
                            title={isResizeMode ? "Finish resizing" : "Resize window"}
                            onPointerDown={(e) => e.stopPropagation()} // Prevent drag start
                        >
                            <Icon name={isResizeMode ? "check" : "move-diagonal"} />
                        </button>
                        <button 
                            className="clickable-icon"
                            onClick={handleClose}
                            title="Close window"
                            onPointerDown={(e) => e.stopPropagation()} // Prevent drag start
                        >
                            <Icon name="x" />
                        </button>
                    </div>
                </div>
                
                <div className="v-diff-window-gap" />
                
                <div className="v-diff-window-content">
                    <DiffPanel panelState={panelState} />
                </div>

                {/* Overlay to block content interaction during resize mode */}
                {isResizeMode && <div className="v-resize-overlay" />}
            </div>

            {/* Ghost outline for resizing */}
            {ghostRect && (
                <div 
                    className="v-diff-window-ghost"
                    style={{
                        transform: `translate(${ghostRect.x}px, ${ghostRect.y}px)`,
                        width: ghostRect.width,
                        height: ghostRect.height,
                        zIndex: 10000
                    }}
                />
            )}
        </>,
        document.body
    );
};
