'use client'

import {useActionState} from 'react'

import {createBookingAction, type BookingFormState} from '../../../../../src/booking/actions.ts'

type Props = {
  service: string
  practitioner: string
  date: string
  time: string
}

const EMPTY: BookingFormState = {}

/**
 * The only client component in the flow.
 *
 * It exists for one reason: errors have to appear next to the field that
 * caused them, tied by `aria-describedby`, without losing what was already
 * typed. Everything else on this route is a server render.
 */
export function DetailsForm({service, practitioner, date, time}: Props) {
  const [state, action, pending] = useActionState(createBookingAction, EMPTY)

  return (
    /*
      The fields are capped, and this is not the reading measure the brief
      rules out. A name field a thousand pixels wide is not more usable for
      being wider -- an input should be about as long as what goes in it, or
      it reads as an invitation to type an essay. The panels and tables
      around it still run to the container.
    */
    <form action={action} className="mt-5 max-w-xl">
      {/* The chosen appointment travels with the form as well as in the URL. */}
      <input type="hidden" name="service" value={service} />
      <input type="hidden" name="practitioner" value={practitioner} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="time" value={time} />

      {state.errors?.slot ? (
        <p role="alert" className="mb-6 border-l-2 border-cancelled bg-surface px-4 py-3 text-sm text-cancelled">
          {state.errors.slot}
        </p>
      ) : null}

      <Field
        name="name"
        label="Your name"
        autoComplete="name"
        required
        error={state.errors?.name}
        defaultValue={state.values?.name}
      />
      <Field
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        required
        hint="The confirmation and the calendar file go here."
        error={state.errors?.email}
        defaultValue={state.values?.email}
      />
      <Field
        name="phone"
        label="Phone number"
        type="tel"
        autoComplete="tel"
        hint="Optional. Only used if the clinic has to move the appointment."
        error={state.errors?.phone}
        defaultValue={state.values?.phone}
      />

      <button
        type="submit"
        disabled={pending}
        className="mt-6 border-2 border-accent bg-accent px-5 py-2.5 font-medium text-accent-ink transition-opacity duration-[120ms] disabled:opacity-60"
      >
        {pending ? 'Confirming…' : 'Confirm appointment'}
      </button>
    </form>
  )
}

function Field({
  name,
  label,
  hint,
  error,
  ...input
}: {
  name: string
  label: string
  hint?: string
  error?: string
  type?: string
  autoComplete?: string
  required?: boolean
  defaultValue?: string
}) {
  const hintId = hint ? `${name}-hint` : undefined
  const errorId = error ? `${name}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className="mt-5">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
        {input.required ? null : <span className="ml-2 text-muted">(optional)</span>}
      </label>

      {hint ? (
        <p id={hintId} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}

      <input
        id={name}
        name={name}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={`mt-2 w-full border bg-surface px-3 py-2 ${
          error ? 'border-cancelled' : 'border-line-strong'
        }`}
        {...input}
      />

      {error ? (
        <p id={errorId} className="mt-1 text-sm text-cancelled">
          {error}
        </p>
      ) : null}
    </div>
  )
}
