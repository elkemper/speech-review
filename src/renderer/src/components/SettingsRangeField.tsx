import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, FocusEvent, KeyboardEvent } from 'react'
import {
  clampToStep,
  formatStepValue,
  parseNumberInput,
  rangeProgress
} from '@shared/format'
import type { SkipPadding } from '@shared/types'
import { useT } from '../i18n'

/**
 * Slider plus a numeric field. The numeric field keeps the user's raw text
 * while it is being edited: empty or half-typed input ("0.", "0,", "-") is
 * never coerced to 0, and a value is committed only when it parses. This is
 * what used to make a field show 0 while the thumb pointed somewhere else.
 */
export function RangeField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  disabled,
  compact,
  ariaLabel,
  onChange
}: {
  label?: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  disabled?: boolean
  compact?: boolean
  ariaLabel?: string
  onChange: (value: number) => void
}) {
  const t = useT()
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)
  const committed = useRef(value)
  const sliderValue = clampToStep(value, min, max, step)
  const shown = draft ?? formatStepValue(sliderValue, step)

  const updateDraft = (next: string | null): void => {
    draftRef.current = next
    setDraft(next)
  }

  useEffect(() => {
    // A reset or another external update replaces the draft; our own commits
    // update `committed` first and keep the field as the user typed it.
    if (committed.current === value) return
    committed.current = value
    updateDraft(null)
  }, [value])

  const commit = (next: number): void => {
    const clamped = clampToStep(next, min, max, step)
    committed.current = clamped
    onChange(clamped)
  }

  const handleText = (text: string): void => {
    updateDraft(text)
    const parsed = parseNumberInput(text)
    if (parsed === null) return
    // Out-of-range text is usually a half-typed number ("1" on the way to
    // "1.5" in a 0.5–2 field). Keep the text and commit the clamped value when
    // the edit finishes; otherwise the thumb would jump to an edge mid-typing.
    if (parsed < min || parsed > max) return
    commit(parsed)
  }

  const finishDraft = (event: FocusEvent<HTMLInputElement>): void => {
    if (draftRef.current !== null) {
      const parsed = parseNumberInput(event.currentTarget.value)
      if (parsed !== null) commit(parsed)
    }
    updateDraft(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
      return
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' ? 1 : -1
    const delta = step * (event.shiftKey ? 10 : 1)
    const base = draft !== null ? parseNumberInput(draft) ?? sliderValue : sliderValue
    updateDraft(null)
    commit(base + direction * delta)
  }

  return (
    <div
      className={`range-field ${compact ? 'compact' : ''} ${disabled ? 'disabled' : ''}`}
    >
      {label ? (
        <div className="range-head">
          <span className="range-label">{label}</span>
        </div>
      ) : null}
      <div className="range-control">
        <input
          className="range-number"
          type="text"
          inputMode="decimal"
          role="spinbutton"
          value={shown}
          disabled={disabled}
          aria-label={ariaLabel ?? label ?? t('common.value')}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={sliderValue}
          onChange={(event) => handleText(event.target.value)}
          onBlur={finishDraft}
          onKeyDown={handleKeyDown}
        />
        {suffix ? <span className="muted small range-suffix">{suffix}</span> : null}
        <input
          className="range-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          disabled={disabled}
          style={{ '--fill': `${rangeProgress(sliderValue, min, max)}%` } as CSSProperties}
          aria-label={ariaLabel ?? label ?? t('common.slider')}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={sliderValue}
          onChange={(event) => {
            updateDraft(null)
            commit(Number(event.target.value))
          }}
        />
      </div>
    </div>
  )
}

export function PaddingField({
  label,
  value,
  disabled,
  onChange
}: {
  label: string
  value: SkipPadding
  disabled?: boolean
  onChange: (value: SkipPadding) => void
}) {
  const t = useT()
  return (
    <div className="padding-field">
      <div className="padding-title">{label}</div>
      <RangeField
        label={t('common.before')}
        value={value.before}
        min={0}
        max={5}
        step={0.05}
        suffix={t('common.secondsSuffix')}
        disabled={disabled}
        compact
        onChange={(before) => onChange({ ...value, before })}
      />
      <RangeField
        label={t('common.after')}
        value={value.after}
        min={0}
        max={5}
        step={0.05}
        suffix={t('common.secondsSuffix')}
        disabled={disabled}
        compact
        onChange={(after) => onChange({ ...value, after })}
      />
    </div>
  )
}

/** Compact before/after pair for a defect row. */
export function InlinePadding({
  value,
  disabled,
  onChange
}: {
  value: SkipPadding
  disabled?: boolean
  onChange: (value: SkipPadding) => void
}) {
  const t = useT()
  return (
    <div className="inline-padding">
      <RangeField
        label={t('common.before')}
        value={value.before}
        min={0}
        max={5}
        step={0.05}
        suffix={t('common.secondsSuffix')}
        disabled={disabled}
        compact
        onChange={(before) => onChange({ ...value, before })}
      />
      <RangeField
        label={t('common.after')}
        value={value.after}
        min={0}
        max={5}
        step={0.05}
        suffix={t('common.secondsSuffix')}
        disabled={disabled}
        compact
        onChange={(after) => onChange({ ...value, after })}
      />
    </div>
  )
}
