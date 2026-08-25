/**
 * Cumulative Layout Shift, per route, measured rather than assumed.
 *
 * `npm run measure` loads every route several times in real Chrome at a phone
 * viewport and reports the **worst** CLS it saw, not the best and not the mean.
 * A layout shift is a race — a font swapping, an image arriving, a fallback
 * being replaced — and a race reported by its best outcome is a race reported
 * as won. Exits non-zero if any route's worst run is above 0.1, which is the
 * Core Web Vitals threshold for "good".
 *
 * **This is not a port.** `C:\Projects\ledger\tools\measure.ts` is a SQL
 * benchmark harness — median and p95 query timings with `explain (analyze,
 * buffers)` plans, wired to that build's metrics layer — and has nothing to do
 * with layout shift. This was written from scratch to do the job that was
 * asked for. Ledger's version has no equivalent here worth porting: Meridian's
 * queries are small, and the property worth proving about its database is the
 * exclusion constraint, which `concurrency.test.ts` already proves against a
 * real Postgres.
 *
 * **Why this matters more here than the number usually does.** Ledger's CLS
 * zeros turned out to be a streamed fallback under-reserving height with the
 * race going the right way — a zero that was luck rather than correctness.
 * Meridian has no streamed fallback at all: `app/unavailable.tsx` records the
 * measurement behind that decision, which is that a `loading.tsx` leaves a
 * no-JavaScript reader looking at "Loading" permanently. So the expectation
 * here is a real zero rather than a lucky one — and the way to tell the
 * difference is to run it several times and quote the worst, which is what
 * this does.
 *
 * No new dependency. It drives Chrome over the DevTools protocol with the same
 * minimal client `a11y-sweep.mjs` uses, because adding Puppeteer to a demo
 * repository for one tool is a worse trade than eighty lines of WebSocket.
 *
 * Usage: node tools/measure.ts [baseUrl] [runs]
 * Needs Chrome installed and the production server running — measure the build
 * that ships, not the dev server, which serves unminified code and its own
 * overlay.
 */

import {spawn} from 'node:child_process'
import {rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:3002'
const RUNS = Number(process.argv[3] ?? 5)
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9226

/** Inside the seeded fortnight, and fixed so runs are comparable. */
const GRID_DATE = process.env.SWEEP_DATE ?? '2026-08-26'

const ROUTES: [string, string][] = [
  ['/', '/'],
  ['/book', '/book'],
  ['/book/[service]', '/book/initial-assessment'],
  ['/book/[service]/[practitioner]', `/book/initial-assessment/nadia-okafor?date=${GRID_DATE}`],
  ['/book/[service]/any', `/book/initial-assessment/any?date=${GRID_DATE}`],
  [
    '/book/.../details',
    `/book/initial-assessment/nadia-okafor/details?date=${GRID_DATE}&time=10:00`,
  ],
  ['/staff', '/staff'],
  ['/not-found', '/no-such-page'],
]

/** Core Web Vitals: 0.1 is the top of "good". */
const CLS_BUDGET = 0.1

const profile = join(tmpdir(), 'measure-' + process.pid)
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--window-size=1280,900',
  '--no-first-run',
  'about:blank',
])

async function endpoint(): Promise<string> {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version')
      return (await r.json()).webSocketDebuggerUrl
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  throw new Error('Chrome never opened its debugging port')
}

function client(url: string) {
  const ws = new WebSocket(url)
  /*
   * `unknown` in, and each `send<T>` narrows on the way out. The protocol is
   * dynamic and this map genuinely does not know what any given reply holds;
   * the caller does, and says so.
   */
  const pending = new Map<
    number,
    {resolve: (v: unknown) => void; reject: (e: Error) => void}
  >()
  let id = 0

  ws.addEventListener('message', (event) => {
    const message = JSON.parse((event as MessageEvent).data as string)
    const waiting = pending.get(message.id)
    if (!waiting) return
    pending.delete(message.id)
    if (message.error) waiting.reject(new Error(message.error.message))
    else waiting.resolve(message.result)
  })

  return {
    ws,
    ready: new Promise<void>((resolve) => ws.addEventListener('open', () => resolve())),
    // Generic rather than `any`: every caller knows the shape it expects back
    // from the protocol, and naming it there keeps this function honest about
    // the fact that it cannot know.
    send<T>(method: string, params: unknown = {}, sessionId?: string): Promise<T> {
      id += 1
      const payload: Record<string, unknown> = {id, method, params}
      if (sessionId) payload.sessionId = sessionId
      ws.send(JSON.stringify(payload))
      return new Promise<T>((resolve, reject) =>
        pending.set(id, {resolve: resolve as (v: unknown) => void, reject}),
      )
    },
  }
}

const root = client(await endpoint())
await root.ready

const {targetId} = await root.send<{targetId: string}>('Target.createTarget', {
  url: 'about:blank',
})
const {sessionId} = await root.send<{sessionId: string}>('Target.attachToTarget', {
  targetId,
  flatten: true,
})
const send = <T = unknown,>(m: string, p?: unknown) => root.send<T>(m, p, sessionId)

await send('Page.enable')
await send('Runtime.enable')

/**
 * A phone, because that is what the numbers in the README are quoted at and
 * what most of the traffic to a booking page is. `mobile: true` also switches
 * on `pointer: coarse`, which this build's controls size themselves behind —
 * measuring desktop density would be measuring a layout nobody on a phone sees.
 */
await send('Emulation.setDeviceMetricsOverride', {
  width: 360,
  height: 780,
  deviceScaleFactor: 2,
  mobile: true,
})

/**
 * The observer has to be installed before the document exists.
 *
 * A `PerformanceObserver` created after load misses every shift that happened
 * during it, which is all of the interesting ones. `addScriptToEvaluateOnNewDocument`
 * runs before any page script on every navigation, so the counter is live from
 * the first paint.
 *
 * `hadRecentInput` entries are excluded, as the specification requires: a shift
 * a person caused by tapping something is not a shift that was done to them.
 */
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__cls = 0;
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__cls += entry.value;
        window.__shifts.push({
          value: entry.value,
          sources: (entry.sources || []).map((s) =>
            s.node ? (s.node.nodeName || '') + (s.node.className ? '.' + String(s.node.className).slice(0, 40) : '') : '?',
          ),
        });
      }
    }).observe({type: 'layout-shift', buffered: true});
  `,
})

async function evaluate<T>(expression: string): Promise<T> {
  const {result, exceptionDetails} = await send<{
    result: {value: T}
    exceptionDetails?: {text?: string}
  }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate failed')
  return result.value
}

async function goto(url: string): Promise<void> {
  const loaded = new Promise<void>((res) => {
    const h = (e: Event) => {
      const m = JSON.parse((e as MessageEvent).data as string)
      if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) {
        root.ws.removeEventListener('message', h)
        res()
      }
    }
    root.ws.addEventListener('message', h)
  })
  await send('Page.navigate', {url})
  await loaded
  /*
    Settle time, and it is doing real work rather than being superstition.
    Fonts swap, React hydrates, and the roving tabindex in the slot grid is
    applied after mount — all three can move something, and all three land
    after `load`. Two and a half seconds is comfortably past the last of them
    on this build.
  */
  await new Promise((r) => setTimeout(r, 2500))
}

type Run = {cls: number; ttfb: number; shifts: {value: number; sources: string[]}[]}

async function measure(url: string): Promise<Run> {
  // A fresh document each time. `about:blank` between runs so the counter and
  // the navigation timing belong to one page rather than accumulating.
  await goto('about:blank')
  await goto(url)
  return await evaluate<Run>(`(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      cls: Math.round((window.__cls || 0) * 10000) / 10000,
      ttfb: nav ? Math.round(nav.responseStart) : -1,
      shifts: (window.__shifts || []).slice(0, 5),
    };
  })()`)
}

console.log(`\nCLS by route — Chrome headless, 360x780 mobile, ${RUNS} runs each`)
console.log(`${BASE}\n`)

let failed = false
const worstShifts: {route: string; shifts: {value: number; sources: string[]}[]}[] = []

console.log(
  'route'.padEnd(32) + 'worst CLS'.padStart(10) + '  all runs'.padEnd(30) + '  TTFB',
)
console.log('-'.repeat(88))

for (const [label, path] of ROUTES) {
  const runs: Run[] = []
  for (let i = 0; i < RUNS; i++) runs.push(await measure(BASE + path))

  const values = runs.map((r) => r.cls)
  const worst = Math.max(...values)
  const ttfbs = runs.map((r) => r.ttfb)
  const worstRun = runs[values.indexOf(worst)]!

  if (worst > CLS_BUDGET) failed = true
  if (worst > 0) worstShifts.push({route: label, shifts: worstRun.shifts})

  console.log(
    label.padEnd(32) +
      worst.toFixed(4).padStart(10) +
      '  ' +
      values.map((v) => v.toFixed(3)).join(' ').padEnd(28) +
      '  ' +
      `${Math.min(...ttfbs)}-${Math.max(...ttfbs)}ms`,
  )
}

console.log('-'.repeat(88))
console.log(`\nBudget: worst-of-${RUNS} CLS must be at or under ${CLS_BUDGET} on every route.`)

/*
 * A zero with nothing behind it is the result this tool exists to distrust, so
 * when a shift *is* found the elements that moved are named. "CLS 0.02" is a
 * number; "the summary panel moved" is something to go and fix.
 */
if (worstShifts.length > 0) {
  console.log('\nWhat moved, on the worst run of each route that shifted at all:')
  for (const {route, shifts} of worstShifts) {
    console.log(`\n  ${route}`)
    for (const s of shifts) {
      console.log(`    ${s.value.toFixed(4)}  ${s.sources.join(', ') || '(no source reported)'}`)
    }
  }
}

console.log()

chrome.kill()
try {
  rmSync(profile, {recursive: true, force: true})
} catch {}

if (failed) {
  console.error(`At least one route is above the ${CLS_BUDGET} budget.\n`)
  process.exit(1)
}
process.exit(0)
