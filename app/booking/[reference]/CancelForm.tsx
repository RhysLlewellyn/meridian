'use client'

import {useActionState} from 'react'

import {cancelBookingAction, type CancelFormState} from '../../../src/booking/actions.ts'

const EMPTY: CancelFormState = {}

/**
 * Cancelling, behind a `<details>` rather than a button that swaps state.
 *
 * The disclosure is native so that the form exists in the document whether or
 * not JavaScript ran — the rest of this flow works with it switched off, and
 * cancelling is the last place to make somebody depend on it. The reason field
 * is a real field for the same kind of reason: the clinic can offer the time
 * on if it knows why it came free, which a `confirm()` dialog cannot capture
 * and a screen reader user would have to fight.
 */
export function CancelForm({reference}: {reference: string}) {
  const [state, action, pending] = useActionState(cancelBookingAction, EMPTY)

  return (
    <details open={Boolean(state.error)} className="mt-3 border border-line">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-cancelled pointer-coarse:py-3">
        Cancel this appointment
      </summary>

      <form action={action} className="border-t border-line p-3">
        <input type="hidden" name="reference" value={reference} />

        <p className="text-sm text-ink-2">
          The time is released straight away and somebody else may take it. This cannot be
          undone.
        </p>

        <label htmlFor="reason" className="mt-4 block text-sm font-medium">
          Why are you cancelling?
        </label>
        <p id="reason-hint" className="mt-1 text-sm text-muted">
          A few words is plenty. It helps the clinic offer the time on.
        </p>
        <input
          id="reason"
          name="reason"
          required
          defaultValue={state.reason}
          aria-describedby={state.error ? 'reason-error reason-hint' : 'reason-hint'}
          aria-invalid={state.error ? true : undefined}
          className={`mt-2 w-full border bg-surface px-3 py-2 pointer-coarse:py-2.5 ${
            state.error ? 'border-cancelled' : 'border-line-strong'
          }`}
        />
        {state.error ? (
          <p id="reason-error" role="alert" className="mt-1 text-sm text-cancelled">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-4 border-2 border-cancelled bg-cancelled px-4 py-2 text-sm font-medium text-ground transition-opacity duration-[120ms] pointer-coarse:py-3 disabled:opacity-60"
        >
          {pending ? 'Cancelling…' : 'Confirm cancellation'}
        </button>
      </form>
    </details>
  )
}
