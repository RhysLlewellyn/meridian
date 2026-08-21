'use client'

import {useRef, useState} from 'react'

import {formatDate, formatDuration} from '../../src/format.ts'

/**
 * The date and time picker, which is the part of a booking site that is
 * usually broken.
 *
 * Four decisions, in the order they matter:
 *
 * **Every position is a real `<button>`, including the ones that cannot be
 * taken.** A grid that renders only free times tells a screen reader user
 * nothing about the shape of the day: six buttons could be a quiet Tuesday or
 * a nearly full one, and there is no way to hear the difference. Booked times
 * are here, focusable, marked `aria-disabled` and saying so out loud. The
 * `disabled` attribute would remove them from the tab order and lose exactly
 * the information they exist to carry.
 *
 * **`aria-disabled`, not `disabled`, means the button must be stopped some
 * other way** — and not with JavaScript, or the page becomes a trap when a
 * script fails to load. `type="button"` does it in the markup: such a button
 * has never submitted a form in any browser, with or without JavaScript, so a
 * booked slot is inert by construction rather than by handler.
 *
 * **Arrow keys move between slots; Tab moves past the grid.** Thirty-two
 * quarter-hours is thirty-two tab stops otherwise, which is a keyboard user
 * held hostage by a Thursday. One roving `tabindex` makes the grid a single
 * stop, which is what the WAI-ARIA practices ask of a composite widget. The
 * row width is measured from the layout rather than assumed, because the grid
 * reflows with the viewport and Up must mean up on a phone too.
 *
 * **The choice paints before the server has answered.** Selection is a
 * navigation, and a navigation has latency; the button fills immediately so
 * the click is visibly received. Nothing is asserted by that fill — the
 * booking is not made here, and if the slot goes in the meantime the server
 * says so on the next screen and the grid comes back without it.
 */

export type GridSlot = {
  time: string
  practitionerName: string
  durationMinutes: number
  /** The path this slot submits to, carrying whoever it belongs to. */
  action: string
}

export type GridBlocked = {
  time: string
  reason: 'booked' | 'too_soon'
}

type Props = {
  date: string
  /** True when the grid shows several practitioners at once. */
  anyPractitioner: boolean
  slots: GridSlot[]
  blocked: GridBlocked[]
}

type Cell =
  | ({kind: 'open'} & GridSlot)
  | ({kind: 'blocked'} & GridBlocked)

export function SlotGrid({date, anyPractitioner, slots, blocked}: Props) {
  const [chosen, setChosen] = useState<string | null>(null)
  const [focused, setFocused] = useState(0)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  const cells: Cell[] = [
    ...slots.map((slot) => ({kind: 'open' as const, ...slot})),
    ...blocked.map((slot) => ({kind: 'blocked' as const, ...slot})),
  ].sort((a, b) => a.time.localeCompare(b.time))

  function move(to: number) {
    const next = Math.max(0, Math.min(cells.length - 1, to))
    setFocused(next)
    buttons.current[next]?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    const columns = columnsIn(event.currentTarget)
    const moves: Record<string, number> = {
      ArrowRight: focused + 1,
      ArrowLeft: focused - 1,
      ArrowDown: focused + columns,
      ArrowUp: focused - columns,
      Home: 0,
      End: cells.length - 1,
    }

    const target = moves[event.key]
    if (target === undefined) return
    event.preventDefault()
    move(target)
  }

  return (
    <ul
      onKeyDown={onKeyDown}
      className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2"
    >
      {cells.map((cell, index) => {
        const shared =
          'tabular block w-full border px-3 py-2 text-left transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

        const when = formatDate(date)

        if (cell.kind === 'blocked') {
          return (
            <li key={cell.time}>
              <button
                // Not `disabled`: it would leave the tab order and take the
                // fact that this time exists with it.
                type="button"
                aria-disabled="true"
                ref={(node) => {
                  buttons.current[index] = node
                }}
                tabIndex={index === focused ? 0 : -1}
                onFocus={() => setFocused(index)}
                className={`${shared} cursor-not-allowed border-line bg-surface-2 text-muted`}
              >
                <span className="block font-medium line-through">{cell.time}</span>
                <span className="block text-xs">
                  {cell.reason === 'booked' ? 'Booked' : 'Too soon'}
                </span>
                <span className="sr-only">
                  {when}
                  {cell.reason === 'booked'
                    ? ', already booked'
                    : ', too soon to book — appointments open two hours ahead'}
                </span>
              </button>
            </li>
          )
        }

        const selected = chosen === cell.time

        return (
          <li key={cell.time}>
            <button
              type="submit"
              name="time"
              value={cell.time}
              formAction={cell.action}
              ref={(node) => {
                buttons.current[index] = node
              }}
              tabIndex={index === focused ? 0 : -1}
              onFocus={() => setFocused(index)}
              onClick={() => setChosen(cell.time)}
              aria-pressed={selected || undefined}
              className={`${shared} ${
                selected
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-line bg-surface hover:border-accent hover:bg-surface-2'
              }`}
            >
              <span className="block font-medium">{cell.time}</span>
              <span
                className={`block text-xs ${selected ? 'text-accent-ink' : 'text-muted'}`}
              >
                {anyPractitioner
                  ? cell.practitionerName
                  : formatDuration(cell.durationMinutes)}
              </span>
              {/*
                Appended, never reordered: WCAG 2.5.3 wants the visible label
                to be a prefix of the accessible name so somebody driving the
                page by voice can say what they can see. Chrome joins block
                children with a space of its own, so this starts with a word
                rather than with the punctuation that would strand it.
              */}
              <span className="sr-only">
                {anyPractitioner
                  ? `${formatDuration(cell.durationMinutes)}, ${when}`
                  : `with ${cell.practitionerName}, ${when}`}
                {selected ? ', selected' : ''}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * How many slots are on the first row, read from the layout rather than
 * assumed.
 *
 * The grid is `auto-fill`, so the row width is whatever the viewport allowed —
 * seven on a laptop, two on a phone. Hard-coding it would make Up and Down
 * jump the wrong distance at every size but one.
 */
function columnsIn(list: HTMLUListElement): number {
  const items = Array.from(list.children) as HTMLElement[]
  if (items.length === 0) return 1

  const top = items[0].offsetTop
  let count = 0
  for (const item of items) {
    if (item.offsetTop !== top) break
    count += 1
  }
  return Math.max(1, count)
}
