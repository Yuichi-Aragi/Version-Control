import {
    type FC,
    useEffect,
    useRef,
    memo,
    useState,
    useMemo,
    type ChangeEvent,
} from 'react';
import { debounce, type Debouncer } from 'obsidian';
import { clamp } from 'lodash-es';
import clsx from 'clsx';
import { parseIntervalToSeconds, formatSecondsToInput } from '../settingsUtils';

type Unit = 'seconds' | 'days' | 'lines';

interface SliderWithInputControlProps {
    min: number;
    max: number;
    step: number;
    value: number;
    disabled: boolean;
    onFinalChange: (value: number) => void;
    unit: Unit;
    placeholder?: string;
}

const formatValue = (value: number, unit: Unit): string => {
    switch (unit) {
        case 'seconds':
            return formatSecondsToInput(value);
        case 'days':
        case 'lines':
            return String(Math.round(value));
        default:
            return String(value);
    }
};

const parseValue = (input: string, unit: Unit): number | null => {
    switch (unit) {
        case 'seconds':
            return parseIntervalToSeconds(input);
        case 'days':
        case 'lines': {
            const num = parseInt(input, 10);
            return isNaN(num) ? null : num;
        }
        default:
            return null;
    }
};


export const SliderWithInputControl: FC<SliderWithInputControlProps> = memo(({
    min,
    max,
    step,
    value: propValue,
    disabled,
    onFinalChange,
    unit,
    placeholder,
}) => {
    const [inputValue, setInputValue] = useState(() => formatValue(propValue, unit));
    const [isValid, setIsValid] = useState(true);
    const lastCommittedValue = useRef(propValue);

    const debouncedOnFinalChange = useMemo(() => {
        const fn = debounce((newValue: number) => {
            if (newValue !== lastCommittedValue.current) {
                onFinalChange(newValue);
                lastCommittedValue.current = newValue;
            }
        }, 800);
        return fn as Debouncer<[number], void>;
    }, [onFinalChange]);

    useEffect(() => {
        // Sync from external prop changes if the value differs from the last committed one.
        if (propValue !== lastCommittedValue.current) {
            setInputValue(formatValue(propValue, unit));
            lastCommittedValue.current = propValue;
            setIsValid(true);
        }
    }, [propValue, unit]);

    const handleInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const newString = e.target.value;
        setInputValue(newString);

        const parsed = parseValue(newString, unit);
        if (parsed !== null) {
            const clamped = clamp(parsed, min, max);
            if (clamped !== propValue) {
                debouncedOnFinalChange(clamped);
            }
            setIsValid(true);
        } else {
            setIsValid(newString.trim() === '');
        }
    };
    
    const handleSliderChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const newNumber = parseFloat(e.target.value);
        setInputValue(formatValue(newNumber, unit));
        debouncedOnFinalChange(newNumber);
        setIsValid(true);
    };

    const handleBlur = (): void => {
        debouncedOnFinalChange.cancel?.();
        const parsed = parseValue(inputValue, unit);
        
        if (parsed !== null) {
            const finalValue = clamp(parsed, min, max);
            if (finalValue !== lastCommittedValue.current) {
                onFinalChange(finalValue);
                lastCommittedValue.current = finalValue;
            }
            setInputValue(formatValue(finalValue, unit));
        } else {
            // Revert to last known good value
            setInputValue(formatValue(propValue, unit));
        }
        setIsValid(true);
    };

    const numericValue = useMemo(() => {
        const parsed = parseValue(inputValue, unit);
        if (parsed !== null) {
            return clamp(parsed, min, max);
        }
        return propValue;
    }, [inputValue, unit, min, max, propValue]);

    return (
        <div className="v-slider-with-input-container">
            <div className="v-slider-container">
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={numericValue}
                    disabled={disabled}
                    onInput={handleSliderChange}
                    onBlur={handleBlur}
                    className="v-slider-input"
                    aria-valuemin={min}
                    aria-valuemax={max}
                    aria-valuenow={numericValue}
                    aria-label="Slider control"
                />
            </div>
            <input
                type="text"
                value={inputValue}
                disabled={disabled}
                onChange={handleInputChange}
                onBlur={handleBlur}
                className={clsx('v-slider-input-field', { 'is-invalid': !isValid })}
                placeholder={placeholder}
                aria-label="Slider value input"
            />
        </div>
    );
});
SliderWithInputControl.displayName = 'SliderWithInputControl';
