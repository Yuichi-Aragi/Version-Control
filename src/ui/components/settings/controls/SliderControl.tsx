import {
  type FC,
  useEffect,
  useRef,
  memo,
  useState,
  useCallback,
  useMemo,
  type ChangeEvent,
} from 'react';
import { debounce, type Debouncer } from 'obsidian';
import { clamp } from 'lodash-es';
import { validateNumber } from '../settingsUtils';

/* Helpers */
const safeNumber = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const snapToStep = (value: number, step: number, min: number) => {
  if (!Number.isFinite(step) || step <= 0) return value;
  // Snap relative to min to behave consistently when min !== 0
  const relative = value - min;
  const stepped = Math.round(relative / step) * step;
  return Number((min + stepped).toFixed(10)); // trim small FP noise
};

interface SliderControlProps {
  min: number;
  max: number;
  step: number;
  value: number;
  disabled: boolean;
  onFinalChange: (value: number) => void;
  formatter?: (value: number) => string;
}

export const SliderControl: FC<SliderControlProps> = memo(function SliderControl({
  min: rawMin,
  max: rawMax,
  step: rawStep,
  value: propValue,
  disabled,
  onFinalChange,
  formatter,
}) {
  // Defensive prop normalisation
  const propMin = useMemo(() => safeNumber(rawMin, 0), [rawMin]);
  const propMax = useMemo(() => safeNumber(rawMax, 100), [rawMax]);
  const propStep = useMemo(() => {
    const s = safeNumber(rawStep, 1);
    return s > 0 ? s : 1;
  }, [rawStep]);

  const [effectiveMin, effectiveMax] = useMemo(() => {
    if (propMin <= propMax) return [propMin, propMax];
    console.warn(`SliderControl: received min > max (${propMin} > ${propMax}). Swapping for safety.`);
    return [propMax, propMin];
  }, [propMin, propMax]);

  // Keep latest onFinalChange in ref (avoid stale closures)
  const latestOnFinalRef = useRef(onFinalChange);
  useEffect(() => {
    latestOnFinalRef.current = onFinalChange;
  }, [onFinalChange]);

  // Initial value (validated)
  const initial = useMemo(() => {
    try {
      return validateNumber(propValue, effectiveMin, effectiveMax);
    } catch (err) {
      console.error('Invalid initial slider value, falling back to min:', err);
      return effectiveMin;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // evaluate once on mount

  // Primary state that represents "committed" snapshot (kept in sync on end/blur/prop changes)
  const [localValue, setLocalValue] = useState<number>(initial);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Refs for fast rAF-driven updates (avoids heavy re-renders)
  const localValueRef = useRef<number>(initial);
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const rafScheduledRef = useRef<number | null>(null);
  const lastClientXRef = useRef<number | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const lastCommittedValueRef = useRef<number>(initial);
  const pendingNativeHandlersRef = useRef<{ move: EventListener; up: EventListener } | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  // Debouncer for live updates (last-wins).
  const debouncer = useMemo(() => {
    const debouncedFn: Debouncer<[number], void> = debounce((v: number) => {
        try {
            const validated = validateNumber(v, effectiveMin, effectiveMax);
            if (validated !== lastCommittedValueRef.current) {
                latestOnFinalRef.current(validated);
                lastCommittedValueRef.current = validated;
            }
        } catch (err) {
            console.error('Debounced commit error:', err);
        }
    }, 120);
    return debouncedFn;
  }, [effectiveMin, effectiveMax]);

  // Sync with external prop when not dragging
  useEffect(() => {
    if (isDraggingRef.current) return;
    try {
      const validated = validateNumber(propValue, effectiveMin, effectiveMax);
      setLocalValue((prev) => {
        if (prev === validated) return prev;
        lastCommittedValueRef.current = validated;
        localValueRef.current = validated;
        return validated;
      });
    } catch (err) {
      console.error('Invalid slider prop value:', err);
    }
  }, [propValue, effectiveMin, effectiveMax]);

  // rAF update step: compute value from lastClientX and apply minimal updates (DOM + state)
  const rafStep = useCallback(() => {
    rafScheduledRef.current = null;
    const slider = sliderRef.current;
    const tooltip = tooltipRef.current;
    const clientX = lastClientXRef.current;
    if (!slider || clientX == null || !isDraggingRef.current) return;

    const rect = slider.getBoundingClientRect();
    const width = rect.width || 1;
    // compute percent clamped
    const pct = clamp((clientX - rect.left) / width, 0, 1);
    const raw = effectiveMin + pct * (effectiveMax - effectiveMin || 1);
    const snapped = snapToStep(raw, propStep, effectiveMin);
    const clamped = clamp(snapped, effectiveMin, effectiveMax);

    const prev = localValueRef.current;
    if (clamped !== prev) {
      // Update refs & React state (React setState is minimal: runs only when changed)
      localValueRef.current = clamped;
      setLocalValue(clamped);
      // schedule a live debounced commit (last-wins)
      debouncer(clamped);
    }

    // Update tooltip text & position via DOM for predictable 60fps
    if (tooltip) {
      try {
        // update text (fast)
        const formatted = (() => {
          if (!formatter) return String(localValueRef.current);
          try {
            return formatter(localValueRef.current);
          } catch (err) {
            console.error('Formatter threw:', err);
            return String(localValueRef.current);
          }
        })();
        if (tooltip.textContent !== formatted) tooltip.textContent = formatted;

        // position tooltip left using slider metrics
        const thumbCss = getComputedStyle(slider).getPropertyValue('--v-slider-thumb-size')?.trim();
        const thumbSize = thumbCss ? Number(thumbCss.replace('px', '')) || 18 : 18;
        const sliderWidth = Math.max(slider.offsetWidth, 1);
        const offset = clamp(
          ((localValueRef.current - effectiveMin) / (effectiveMax - effectiveMin || 1)) * (sliderWidth - thumbSize) +
            thumbSize / 2,
          thumbSize / 2,
          sliderWidth - thumbSize / 2
        );
        tooltip.style.left = `${offset}px`;
        tooltip.style.transform = 'translateX(-50%)';
      } catch (err) {
        console.error('Tooltip DOM update error:', err);
      }
    }

    // Update native input aria/value attributes for assistive tech immediately
    if (slider) {
      try {
        (slider as HTMLInputElement).value = String(localValueRef.current);
        slider.setAttribute('aria-valuenow', String(localValueRef.current));
      } catch {
        // ignore
      }
    }
  }, [effectiveMin, effectiveMax, propStep, formatter, debouncer]);

  const scheduleRaf = useCallback(() => {
    if (rafScheduledRef.current == null) {
      rafScheduledRef.current = requestAnimationFrame(() => rafStep());
    }
  }, [rafStep]);

  // Unified pointer move handler (EventListener signature, narrow inside)
  const onPointerMoveNative = useCallback((ev: Event) => {
    if (!isDraggingRef.current) return;

    let clientX: number | null = null;
    // Narrow to TouchEvent
    if ((ev as TouchEvent).touches !== undefined) {
      const te = ev as TouchEvent;
      if (te.touches && te.touches.length > 0) clientX = te.touches[0].clientX;
    } else if ((ev as PointerEvent).clientX !== undefined) {
      clientX = (ev as PointerEvent).clientX;
    } else if ((ev as MouseEvent).clientX !== undefined) {
      clientX = (ev as MouseEvent).clientX;
    }

    if (clientX == null) return;
    lastClientXRef.current = clientX;
    scheduleRaf();
  }, [scheduleRaf]);

  // Pointer up / cancel native (EventListener signature)
  const onPointerUpNative = useCallback((ev?: Event) => {
    if (!isDraggingRef.current) return;
    try {
      ev?.preventDefault?.();
    } catch {
      /* ignore */
    }

    // commit latest value immediately (cancel any pending debounced live update)
    debouncer.cancel?.();
    const final = localValueRef.current;
    try {
      const validated = validateNumber(final, effectiveMin, effectiveMax);
      if (validated !== lastCommittedValueRef.current) {
        latestOnFinalRef.current(validated);
        lastCommittedValueRef.current = validated;
      }
    } catch (err) {
      console.error('Error onFinalChange at pointer up:', err);
    }

    // restore states
    isDraggingRef.current = false;
    setIsDragging(false);

    // remove native handlers added on start (guarded)
    if (pendingNativeHandlersRef.current) {
      const { move, up } = pendingNativeHandlersRef.current;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      pendingNativeHandlersRef.current = null;
    }

    // release pointer capture if possible
    try {
      if (pointerIdRef.current != null) {
        sliderRef.current?.releasePointerCapture?.(pointerIdRef.current);
        pointerIdRef.current = null;
      }
    } catch {
      // ignore if not possible
    }

    // cancel any scheduled rAF
    if (rafScheduledRef.current != null) {
      cancelAnimationFrame(rafScheduledRef.current);
      rafScheduledRef.current = null;
    }

    // Sync React state with final value (keeps component controlled)
    setLocalValue(localValueRef.current);
  }, [effectiveMin, effectiveMax, debouncer]);

  // Start dragging / pointerdown react handler
  const onPointerStart = useCallback((e: React.PointerEvent | React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;

    try {
      (e as any).preventDefault?.();
      (e as any).stopPropagation?.();
    } catch {
      // ignore
    }

    const slider = sliderRef.current;
    if (!slider) return;

    isDraggingRef.current = true;
    setIsDragging(true);
    if ('pointerId' in e) {
      try {
        pointerIdRef.current = (e as React.PointerEvent).pointerId;
        slider.setPointerCapture?.(pointerIdRef.current);
      } catch {
        pointerIdRef.current = null;
      }
    } else {
      pointerIdRef.current = null;
    }

    let clientX: number | null = null;
    if ('touches' in e) {
      const te = e as React.TouchEvent;
      if (te.touches && te.touches.length > 0) clientX = te.touches[0].clientX;
    } else if ('clientX' in e) {
      clientX = (e as React.MouseEvent | React.PointerEvent).clientX;
    }

    if (clientX != null) {
      lastClientXRef.current = clientX;
      scheduleRaf();
    }

    const move: EventListener = (ev: Event) => onPointerMoveNative(ev);
    const up: EventListener = (ev?: Event) => onPointerUpNative(ev);

    pendingNativeHandlersRef.current = { move, up };

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false } as AddEventListenerOptions);
    document.addEventListener('touchend', up);
  }, [disabled, scheduleRaf, onPointerMoveNative, onPointerUpNative]);

  // Keyboard / native input changes (accessible)
  const handleInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      try {
        const parsed = parseFloat(e.target.value);
        let value = validateNumber(parsed, effectiveMin, effectiveMax);
        value = snapToStep(value, propStep, effectiveMin);
        debouncer(value);
        setLocalValue(value);
        localValueRef.current = value;
      } catch (err) {
        console.error('Invalid slider input (keyboard):', err);
      }
    },
    [effectiveMin, effectiveMax, propStep, debouncer]
  );

  // Commit on blur (immediate final commit)
  const handleBlur = useCallback(() => {
    try {
      debouncer.cancel?.();
      const validated = validateNumber(localValueRef.current, effectiveMin, effectiveMax);
      if (validated !== lastCommittedValueRef.current) {
        latestOnFinalRef.current(validated);
        lastCommittedValueRef.current = validated;
      }
      setLocalValue(localValueRef.current);
    } catch (err) {
      console.error('Error committing on blur:', err);
    }
  }, [effectiveMin, effectiveMax, debouncer]);

  // Cleanup all listeners / timers on unmount
  useEffect(() => {
    return () => {
      debouncer.cancel?.();
      if (pendingNativeHandlersRef.current) {
        const { move, up } = pendingNativeHandlersRef.current;
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', up);
        pendingNativeHandlersRef.current = null;
      }
      if (rafScheduledRef.current != null) {
        cancelAnimationFrame(rafScheduledRef.current);
        rafScheduledRef.current = null;
      }
    };
  }, [debouncer]);

  const displayValue = useMemo(() => {
    try {
      return formatter ? formatter(localValue) : String(localValue);
    } catch (err) {
      console.error('Error in formatter:', err);
      return String(localValue);
    }
  }, [formatter, localValue]);

  return (
    <div
      className="v-slider-container"
      role="group"
      aria-disabled={disabled}
      aria-label="Slider control"
    >
      <input
        ref={sliderRef}
        type="range"
        min={effectiveMin}
        max={effectiveMax}
        step={propStep}
        value={localValue}
        disabled={disabled}
        onInput={handleInput}
        onPointerDown={onPointerStart}
        onBlur={handleBlur}
        className="v-slider-input"
        aria-valuemin={effectiveMin}
        aria-valuemax={effectiveMax}
        aria-valuenow={localValue}
        aria-label={`Slider control, current value: ${displayValue}`}
        style={{ touchAction: 'pan-y' }}
      />
      {isDragging && (
        <div
          ref={tooltipRef}
          className="v-slider-tooltip"
          role="status"
          aria-live="polite"
        >
          {displayValue}
        </div>
      )}
    </div>
  );
});

SliderControl.displayName = 'SliderControl';
