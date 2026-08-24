'use client'

import Link from 'next/link'
import {useMemo, useState} from 'react'

import {formatRelativeDay} from '../src/format.ts'

/**
 * The practitioner directory, with its filters.
 *
 * The chips are **specialties**, which is not a decorative taxonomy: a
 * practitioner's specialties are the distinct specialties of the services they
 * are linked to in `practitioner_service`, so this is the same vocabulary the
 * availability engine uses to decide who may be offered for what. Filtering
 * the directory and filtering the grid are the same question asked in two
 * places.
 *
 * Filtering happens in the browser rather than through the server, because
 * three practitioners are already on the page and a round trip to hide one of
 * them would be slower and worse. The count is announced politely so the
 * result of a filter is available to somebody who cannot see the cards
 * disappear.
 */

export type DirectoryPractitioner = {
  id: string
  name: string
  slug: string
  title: string
  bio: string
  specialties: string[]
  /** From the availability engine, or absent if nothing in the next fortnight. */
  next?: {date: string; time: string; serviceSlug: string}
}

type Props = {
  practitioners: DirectoryPractitioner[]
  specialties: string[]
  /** Today in the clinic's timezone, for "Today" and "Tomorrow". */
  today: string
}

export function PractitionerDirectory({practitioners, specialties, today}: Props) {
  const [query, setQuery] = useState('')
  const [specialty, setSpecialty] = useState<string | null>(null)

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return practitioners.filter((person) => {
      if (specialty && !person.specialties.includes(specialty)) return false
      if (!needle) return true
      return [person.name, person.title, ...person.specialties]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [practitioners, query, specialty])

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-y border-line py-3">
        <div className="flex items-center gap-2">
          <label htmlFor="practitioner-search" className="text-sm text-ink-2">
            Search
          </label>
          <input
            id="practitioner-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or specialty"
            className="w-52 border border-line-strong bg-surface px-2 py-1.5 text-sm"
          />
        </div>

        {/*
          Toggle buttons rather than links: this filter does not change what
          the page is about, and putting it in the URL would make the back
          button undo a filter instead of leaving the page. The booking flow's
          state is in the URL because it is a task with a position in it; this
          is a view of one list.
        */}
        <div
          role="group"
          aria-label="Filter by specialty"
          className="flex flex-wrap gap-2"
        >
          <Chip pressed={specialty === null} onClick={() => setSpecialty(null)}>
            All practitioners
          </Chip>
          {specialties.map((name) => (
            <Chip
              key={name}
              pressed={specialty === name}
              onClick={() => setSpecialty(specialty === name ? null : name)}
            >
              {name}
            </Chip>
          ))}
        </div>

        <p aria-live="polite" className="tabular ml-auto text-sm text-muted">
          {shown.length} of {practitioners.length} practitioners
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 border border-line bg-surface px-4 py-6 text-sm text-muted">
          No practitioners match that. Clear the search, or choose “All practitioners”.
        </p>
      ) : (
        <ul className="mt-4 grid border-t border-l border-line sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((person) => (
            <li key={person.id} className="flex flex-col border-r border-b border-line bg-surface p-4">
              <div className="flex items-start gap-3">
                {/*
                  Initials, not a photograph. There is no real Nadia Okafor,
                  and a stock or generated face on a fictional clinician is a
                  small lie told for decoration.
                */}
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center border border-line bg-surface-2 font-mono text-xs tracking-[0.06em] text-ink-2"
                >
                  {initialsOf(person.name)}
                </span>
                <div className="min-w-0">
                  <h3 className="font-medium">{person.name}</h3>
                  <p className="text-sm text-muted">{person.title}</p>
                </div>
              </div>

              <p className="mt-3 text-sm text-ink-2">{person.bio}</p>

              <ul className="mt-3 flex flex-wrap gap-1">
                {person.specialties.map((name) => (
                  <li
                    key={name}
                    className="border border-line px-1.5 py-0.5 font-mono text-[0.6875rem] tracking-[0.06em] text-muted uppercase"
                  >
                    {name}
                  </li>
                ))}
              </ul>

              <div className="mt-auto border-t border-line pt-3">
                <p className="font-mono text-[0.625rem] tracking-[0.1em] text-muted uppercase">
                  Next available
                </p>
                {person.next ? (
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="tabular text-sm">
                      {formatRelativeDay(person.next.date, today)}, {person.next.time}
                    </p>
                    {/*
                      Straight to the grid that produced this answer, with the
                      date already in the URL — the whole flow keeps its state
                      there, so a link from the directory lands two steps in
                      rather than starting over.
                    */}
                    <Link
                      href={`/book/${person.next.serviceSlug}/${person.slug}?date=${person.next.date}`}
                      className="border border-line-strong px-3 py-1.5 text-sm whitespace-nowrap transition-colors duration-[120ms] hover:border-accent hover:bg-surface-2"
                    >
                      See times
                      <span className="sr-only"> with {person.name}</span>
                    </Link>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-muted">
                    Nothing in the next two weeks.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`border px-3 py-1.5 text-sm transition-colors duration-[120ms] ${
        pressed
          ? 'border-accent bg-accent font-medium text-accent-ink'
          : 'border-line-strong text-ink-2 hover:bg-surface-2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
