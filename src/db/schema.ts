import {sql} from 'drizzle-orm'
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Postgres range types have no Drizzle primitive, and this one is not optional
 * decoration: `booking.during` is what the exclusion constraint indexes. It is
 * declared here so the type system knows the column exists and so migrations
 * generate it, but nothing in the application ever writes to it — Postgres
 * derives it from starts_at and ends_at.
 */
const tstzrange = customType<{data: string; driverData: string}>({
  dataType: () => 'tstzrange',
})

/**
 * Every timestamp in this schema is `timestamptz`. There is no such thing as a
 * naive appointment time: a booking exists at an instant, and the only reason
 * to store a wall-clock string would be to reconstruct the instant later,
 * badly, having lost the offset.
 *
 * The exception is `working_hours`, which is genuinely wall-clock — see there.
 */
const at = (name: string) => timestamp(name, {withTimezone: true, mode: 'date'})

export const bookingStatus = pgEnum('booking_status', ['confirmed', 'cancelled'])

export const practitioner = pgTable(
  'practitioner',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** "MSK Physiotherapist" — the line under the name, not an honorific. */
    title: text('title').notNull(),
    bio: text('bio').notNull(),
    /**
     * Soft delete. A practitioner who leaves must not vanish from the
     * bookings they already have, and their name still has to render on a
     * past appointment.
     */
    active: boolean('active').notNull().default(true),
  },
  (t) => [uniqueIndex('practitioner_slug_key').on(t.slug)],
)

export const service = pgTable(
  'service',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull(),
    /** Minutes. The fallback when a practitioner has no override. */
    defaultDurationMinutes: integer('default_duration_minutes').notNull(),
    /** Pence. Money is never a float. */
    pricePence: integer('price_pence').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => [uniqueIndex('service_slug_key').on(t.slug)],
)

/**
 * Which practitioner offers which service, and on what terms.
 *
 * This table is the reason the availability engine is not a loop over a
 * calendar. The same service takes different practitioners different amounts
 * of time — an initial assessment is 45 minutes with Nadia and 60 with
 * Tomas — so the length of a slot depends on *who* is being booked, and the
 * question "does this appointment fit before closing?" has a different answer
 * per practitioner on the same day.
 *
 * Both overrides are nullable and mean "use the service default".
 */
export const practitionerService = pgTable(
  'practitioner_service',
  {
    practitionerId: uuid('practitioner_id')
      .notNull()
      .references(() => practitioner.id, {onDelete: 'cascade'}),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => service.id, {onDelete: 'cascade'}),
    durationMinutesOverride: integer('duration_minutes_override'),
    pricePenceOverride: integer('price_pence_override'),
  },
  (t) => [
    primaryKey({columns: [t.practitionerId, t.serviceId]}),
    index('practitioner_service_service_idx').on(t.serviceId),
  ],
)

/**
 * Recurring weekly availability, in **local wall-clock time**.
 *
 * These are deliberately `time` and not `timestamptz`. A practitioner works
 * 09:00–17:00, and they work 09:00–17:00 on the day the clocks change too.
 * Storing an offset here would silently move everybody's working day by an
 * hour twice a year, which is the single most common bug in booking software
 * and the reason there is a DST test in this repo.
 *
 * The wall-clock hours are resolved against Europe/London at the moment a
 * specific date is being considered, not before.
 */
export const workingHours = pgTable(
  'working_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    practitionerId: uuid('practitioner_id')
      .notNull()
      .references(() => practitioner.id, {onDelete: 'cascade'}),
    /** 0 = Sunday, matching JavaScript's getDay(). */
    weekday: integer('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
  },
  (t) => [index('working_hours_practitioner_weekday_idx').on(t.practitionerId, t.weekday)],
)

/**
 * Anything that removes a practitioner from availability without being a
 * booking: lunch, annual leave, a training afternoon.
 *
 * One mechanism rather than three. A lunch break and a fortnight in Portugal
 * are the same shape of fact — this practitioner is not available between
 * these two instants — and the engine treats them identically to a booking.
 */
export const timeOff = pgTable(
  'time_off',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    practitionerId: uuid('practitioner_id')
      .notNull()
      .references(() => practitioner.id, {onDelete: 'cascade'}),
    startsAt: at('starts_at').notNull(),
    endsAt: at('ends_at').notNull(),
    reason: text('reason').notNull(),
    /** Same generated range as booking.during, for the same reason. */
    during: tstzrange('during').generatedAlwaysAs(
      sql`tstzrange("starts_at", "ends_at", '[)')`,
    ),
  },
  (t) => [index('time_off_practitioner_starts_idx').on(t.practitionerId, t.startsAt)],
)

/**
 * The person being seen. No accounts and no passwords: this is a booking form,
 * not a portal, and storing a credential nobody asked for is a liability
 * rather than a feature.
 */
export const client = pgTable(
  'client',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('client_email_idx').on(t.email)],
)

export const booking = pgTable(
  'booking',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Short, human-readable, and what a client is asked for on the phone:
     * MRD-8F3K. The primary key is a uuid because it should not be guessable;
     * this exists because a uuid cannot be read down a telephone.
     */
    reference: text('reference').notNull(),
    practitionerId: uuid('practitioner_id')
      .notNull()
      .references(() => practitioner.id),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => service.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => client.id),
    startsAt: at('starts_at').notNull(),
    endsAt: at('ends_at').notNull(),
    /**
     * Generated by Postgres, never written by the application. This is the
     * column the exclusion constraint indexes, and deriving it in the database
     * is what stops it disagreeing with starts_at/ends_at.
     *
     * '[)' — half open. An appointment ending at 11:00 and one starting at
     * 11:00 do not overlap, and with '[]' they would.
     */
    during: tstzrange('during').generatedAlwaysAs(
      sql`tstzrange("starts_at", "ends_at", '[)')`,
    ),
    status: bookingStatus('status').notNull().default('confirmed'),
    cancellationReason: text('cancellation_reason'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('booking_reference_key').on(t.reference),
    // The engine's hot query: confirmed bookings for a practitioner on a day.
    index('booking_practitioner_starts_idx').on(t.practitionerId, t.startsAt),
    index('booking_client_idx').on(t.clientId),
  ],
)

/**
 * What happened to a booking and when.
 *
 * Nothing in the demo reads it. It is here because a system that takes
 * appointments and money-adjacent commitments and cannot answer "who
 * cancelled this and when" is not finished, and adding it later means
 * backfilling history that no longer exists.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => booking.id, {onDelete: 'cascade'}),
    action: text('action').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_booking_idx').on(t.bookingId, t.createdAt)],
)

export type Practitioner = typeof practitioner.$inferSelect
export type Service = typeof service.$inferSelect
export type PractitionerService = typeof practitionerService.$inferSelect
export type WorkingHours = typeof workingHours.$inferSelect
export type TimeOff = typeof timeOff.$inferSelect
export type Client = typeof client.$inferSelect
export type Booking = typeof booking.$inferSelect
export type NewBooking = typeof booking.$inferInsert
