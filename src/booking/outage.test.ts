/**
 * What the two write actions do when Postgres is not there.
 *
 * Every other database test in this repository needs a real Postgres and skips
 * without one. This one needs the opposite and so it never skips: the whole
 * subject is an unreachable database, and the most reliable way to have one is
 * to point the pool at a port with nothing behind it. `connect()` is lazy, so
 * the failure arrives where it would in production — on the first query, as a
 * rejected promise out of the driver — rather than at construction.
 *
 * What is being asserted is narrow and worth stating plainly: that these
 * actions **return** rather than **throw**. A thrown action reaches the error
 * boundary, and the error boundary needs JavaScript to render (measured; see
 * `app/error.tsx`), so a reader with scripting off gets a blank page and no
 * idea whether they have an appointment. A returned form state is rendered by
 * the server into the page they are already on, with or without scripting.
 *
 * The three failure points are not equivalent and the tests keep them apart:
 * before the insert, nothing was written and the copy may promise it; at the
 * insert, nothing here can know, and the copy must not promise it.
 */

import {beforeAll, describe, expect, it, vi} from 'vitest'

import {connect} from '../db/client.ts'

/**
 * Seed the application's connection with a dead one before the actions module
 * is loaded. `getDb()` is `globalForDb.meridian ??= connect(...)`, so putting
 * something there first is the supported way to hand it a different pool
 * without reaching into its internals or touching `DATABASE_URL`, which the
 * rest of the suite is using for a database that does work.
 *
 * Port 1 is reserved and never listened on. `connectTimeoutSeconds` keeps a
 * host that black-holes rather than refuses from hanging the file.
 */
const DEAD_URL = 'postgres://nobody:nothing@127.0.0.1:1/nowhere'

const globalForDb = globalThis as {meridian?: ReturnType<typeof connect>}

beforeAll(() => {
  globalForDb.meridian = connect(DEAD_URL, {max: 1, connectTimeoutSeconds: 2})
})

function bookingForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData()
  const fields: Record<string, string> = {
    service: 'initial-assessment',
    practitioner: 'nadia-okafor',
    date: '2026-09-01',
    time: '10:00',
    name: 'Test Person',
    email: 'test@example.com',
    phone: '',
    ...overrides,
  }
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  return form
}

describe('createBookingAction with no database', () => {
  it('returns a slot error rather than throwing', async () => {
    const {createBookingAction} = await import('./actions.ts')
    const state = await createBookingAction({}, bookingForm())

    expect(state.errors?.slot).toBeTruthy()
  })

  it('promises that nothing was booked, because nothing was', async () => {
    const {createBookingAction} = await import('./actions.ts')
    const state = await createBookingAction({}, bookingForm())

    // The failure is the first read, long before the insert. This is the one
    // case where the action is allowed to say nothing happened.
    expect(state.errors?.slot).toContain('No appointment has been made')
  })

  it('keeps what was typed, so the form comes back filled in', async () => {
    const {createBookingAction} = await import('./actions.ts')
    const state = await createBookingAction({}, bookingForm({name: 'Ada Lovelace'}))

    expect(state.values?.name).toBe('Ada Lovelace')
    expect(state.values?.email).toBe('test@example.com')
  })

  it('still validates before it reaches the database', async () => {
    const {createBookingAction} = await import('./actions.ts')
    const state = await createBookingAction({}, bookingForm({name: '   '}))

    // A whitespace-only name must still be a name error. If the outage catch
    // had been wrapped around the validation too, this would come back as
    // "the database is not answering", which is both wrong and unfixable by
    // the person reading it.
    expect(state.errors?.name).toBe('Enter your name.')
    expect(state.errors?.slot).toBeUndefined()
  })
})

describe('cancelBookingAction with no database', () => {
  it('returns an error rather than throwing', async () => {
    const {cancelBookingAction} = await import('./actions.ts')
    const form = new FormData()
    form.set('reference', 'MRD-8F3K')
    form.set('reason', 'No longer needed')

    const state = await cancelBookingAction({}, form)

    expect(state.error).toBeTruthy()
    // Safe to say without qualification, because a second attempt on a row
    // that was already cancelled comes back `already_cancelled` rather than
    // cancelling it twice.
    expect(state.error).toContain('try again')
    expect(state.reason).toBe('No longer needed')
  })
})

/**
 * The insert failing is a different case from the reads failing, and the
 * difference is the whole point: at this stage nothing in this process can
 * know whether the appointment exists.
 *
 * The reads are mocked to succeed so that execution actually reaches the
 * insert, and `createBooking` is mocked to throw the way a connection dying
 * mid-transaction would. Neither mock is standing in for the guarantee — the
 * exclusion constraint is proved against a real Postgres in
 * `concurrency.test.ts`, and mocking it here would prove nothing. What is
 * mocked is the failure, which is the only part that cannot be arranged on
 * demand.
 */
describe('createBookingAction when the insert itself fails', () => {
  it('does not claim the appointment was not made', async () => {
    vi.resetModules()

    vi.doMock('../availability/query.ts', () => ({
      getServiceBySlug: async () => ({
        id: 'service-1',
        slug: 'initial-assessment',
        name: 'Initial assessment',
        specialty: 'Assessment',
      }),
      listPractitionersForService: async () => [
        {
          id: 'practitioner-1',
          slug: 'nadia-okafor',
          name: 'Nadia Okafor',
          title: 'MSK Physiotherapist',
          durationMinutes: 45,
          pricePence: 7500,
        },
      ],
      availabilityFor: async () => ({slots: [{time: '10:00'}], unavailable: []}),
    }))

    vi.doMock('./create.ts', () => ({
      createBooking: async () => {
        throw new Error('connection terminated unexpectedly')
      },
    }))

    // The client lookup runs against the dead pool and would return first, so
    // it is stubbed out of the way to let the insert be the thing that fails.
    vi.doMock('../db/index.ts', () => ({
      getDb: () => ({
        select: () => ({
          from: () => ({where: () => ({limit: async () => [{id: 'client-1'}]})}),
        }),
      }),
    }))

    const {createBookingAction} = await import('./actions.ts')
    const state = await createBookingAction({}, bookingForm())

    expect(state.errors?.slot).toBeTruthy()
    expect(state.errors?.slot).not.toContain('No appointment has been made')
    expect(state.errors?.slot).toContain('not clear whether the appointment was made')
    // And the sentence that stops somebody talking themselves out of retrying.
    expect(state.errors?.slot).toContain('safe')

    vi.doUnmock('../availability/query.ts')
    vi.doUnmock('./create.ts')
    vi.doUnmock('../db/index.ts')
    vi.resetModules()
  })
})
