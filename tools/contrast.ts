/**
 * Every contrast ratio the interface uses, checked rather than claimed.
 *
 * `npm run contrast` prints the table and exits non-zero if any pairing falls
 * below its WCAG 2.2 threshold. The point is that the accessibility claim in
 * this build is not "the colours look about right" — it is a number somebody
 * else can reproduce, and a broken one fails a command rather than waiting for
 * an audit.
 *
 * **The tokens are read out of `app/globals.css` rather than copied here.** The
 * stylesheet already argues its own contrast maths in comments — three of these
 * colours were raised off the brief's palette because they failed, one of them
 * by 0.003 — and a second copy of the palette in this file would be a second
 * copy to keep in step. It would also be the copy that stayed right while the
 * real one drifted, which is the failure mode worth designing out: a checker
 * that checks colours nothing ships is a checker that always passes.
 *
 * The pairs listed are the combinations the components actually use, taken from
 * the class names in `app/`. A palette where every colour clears every other
 * colour is a palette with no dark colours in it; what matters is that the
 * combinations that ship are sound.
 */

import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

type Rgb = [number, number, number]

const CSS = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'globals.css')

/**
 * Pull `--color-*: #rrggbb` out of the `@theme` block.
 *
 * Deliberately strict about the hex: a token defined as anything else — a
 * `color-mix`, an `oklch`, a `var()` — is not silently skipped but reported, so
 * that a palette this tool has stopped being able to read cannot look like a
 * palette with nothing wrong with it.
 */
function readTokens(): {tokens: Record<string, string>; unreadable: string[]} {
  const css = readFileSync(CSS, 'utf8')
  const tokens: Record<string, string> = {}
  const unreadable: string[] = []

  for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) {
    const name = match[1]!
    const value = match[2]!.trim()
    if (/^#[0-9a-f]{6}$/i.test(value)) tokens[name] = value
    else unreadable.push(`${name}: ${value}`)
  }
  return {tokens, unreadable}
}

/**
 * foreground, background, minimum, what uses it.
 *
 * A minimum of 0 means "decorative — reported so the number is visible, but not
 * required to clear anything". That distinction is the whole reason this table
 * has a column for it. WCAG 1.4.11 asks 3:1 of *user interface components* and
 * of *graphical objects required to understand the content*; it does not ask it
 * of a hairline between two table rows. Holding a decorative rule to 3:1 would
 * mean a page ruled in mid-grey, which is a worse page and no more accessible.
 *
 * So the lines are split by job rather than by shade. `line` separates things
 * and is decorative. `line-strong` outlines slot buttons, inputs and controls,
 * and has to clear 3:1 — it is what identifies them as controls, and neither
 * axe nor Lighthouse checks it.
 *
 * Three grounds rather than one, because this build layers surfaces: `ground`
 * is the page, `surface` is a panel or a table row, `surface-2` is a hover
 * fill and the fill behind an unavailable slot. Text that clears on the page
 * and fails on a hovered row has failed.
 */
const PAIRS: [string, string, number, string][] = [
  ['ink', 'ground', 4.5, 'body text'],
  ['ink', 'surface', 4.5, 'text in a panel or table row'],
  ['ink', 'surface-2', 4.5, 'text on a hovered row, a well, an active nav item'],

  ['ink-2', 'ground', 4.5, 'secondary prose'],
  ['ink-2', 'surface', 4.5, 'secondary prose in a panel'],
  ['ink-2', 'surface-2', 4.5, 'secondary prose on a hovered row'],

  ['muted', 'ground', 4.5, 'hints, eyebrow labels, definition terms'],
  ['muted', 'surface', 4.5, 'the same inside a panel'],
  ['muted', 'surface-2', 4.5, 'the same on a hover fill and behind an unavailable slot'],

  ['accent', 'ground', 4.5, 'the Confirmed badge and links, which are text'],
  ['accent', 'surface', 4.5, 'the Confirmed badge in the schedule table'],
  ['accent', 'surface-2', 4.5, 'the same on a hovered row'],
  ['accent-ink', 'accent', 4.5, 'text on a selected slot and on a filled button'],

  ['cancelled', 'ground', 4.5, 'error text and the Cancelled badge'],
  ['cancelled', 'surface', 4.5, 'the same in a panel or table row'],
  ['cancelled', 'surface-2', 4.5, 'the same on a hovered row'],
  ['ground', 'cancelled', 4.5, 'text on the filled Confirm cancellation button'],

  ['pending', 'surface', 4.5, 'the withheld-email notice on the confirmation page'],

  [
    'line-strong',
    'ground',
    3,
    'control borders — WCAG 1.4.11, and what identifies a slot as a button',
  ],
  ['line-strong', 'surface', 3, 'the same on a panel'],
  ['line-strong', 'surface-2', 3, 'the same on a hover fill'],

  ['focus', 'ground', 3, 'the focus ring, which is a UI component boundary'],
  ['focus', 'surface', 3, 'the focus ring over a panel'],

  ['line', 'ground', 0, 'decorative — hairline between rows and panels'],
  ['line', 'surface', 0, 'decorative — the same inside a panel'],
]

function parse(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function ratio(a: Rgb, b: Rgb): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1! + 0.05) / (l2! + 0.05)
}

const {tokens, unreadable} = readTokens()

let failed = false
const rows: string[] = []

/*
 * A pair naming a token that is not in the stylesheet is a failure, not a skip.
 * Renaming a token and leaving this list behind would otherwise quietly reduce
 * the number of things being checked while the command kept printing "ok".
 */
const missing = [...new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]))].filter(
  (name) => !(name in tokens),
)

for (const [fg, bg, min, use] of PAIRS) {
  if (!(fg in tokens) || !(bg in tokens)) continue
  const r = ratio(parse(tokens[fg]!), parse(tokens[bg]!))
  const ok = r >= min
  const label = min === 0 ? 'note' : `min ${String(min).padStart(3)}`
  if (!ok) failed = true
  rows.push(
    `${min === 0 ? '  -- ' : ok ? '  ok ' : 'FAIL '}${r.toFixed(2).padStart(6)}:1  (${label})  ` +
      `${fg} on ${bg}`.padEnd(28) +
      `  ${use}`,
  )
}

console.log(`\nContrast, WCAG 2.2, sRGB — tokens read from app/globals.css\n`)
console.log(rows.join('\n'))
console.log(`\n  ${PAIRS.length} pairings, ${Object.keys(tokens).length} tokens read`)

if (unreadable.length > 0) {
  console.error(`\nTokens this tool could not parse as a plain hex colour:`)
  for (const line of unreadable) console.error(`  ${line}`)
  console.error('Their pairings were not checked.')
  failed = true
}

if (missing.length > 0) {
  console.error(`\nPairings name tokens that are not in the stylesheet: ${missing.join(', ')}`)
  console.error('Either the token was renamed or this list is stale. Nothing was checked')
  console.error('for those pairs.')
  failed = true
}

console.log()

if (failed) {
  console.error('At least one pairing the interface uses is below its threshold.\n')
  process.exit(1)
}
