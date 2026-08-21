/**
 * The mechanical half of a keyboard and screen-reader pass.
 *
 * Drives real Chrome over the DevTools protocol, tabs through each page the
 * way a keyboard user would, and reports what the browser exposes at every
 * stop. It does NOT replace listening to the site with a screen reader: this
 * reads the accessibility *tree*, and NVDA is a separate consumer that layers
 * its own behaviour on top. What it is for is making the manual pass short and
 * aimed — answering the yes/no questions mechanically so the twenty minutes of
 * listening goes on the parts that actually need ears.
 *
 * Meridian's version adds a probe the marketing-site version had no need for:
 * the slot grid is a composite widget with a roving `tabindex`, so "how many
 * tab stops" is the wrong question and "does Tab reach it once, and do the
 * arrow keys move inside it" is the right one.
 *
 * Usage: node tools/a11y-sweep.mjs [baseUrl]
 * Needs Chrome installed and the dev or production server running.
 */
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const require = createRequire(import.meta.url)

const BASE = process.argv[2] ?? 'http://localhost:3002'
const AXE = require.resolve('axe-core/axe.min.js')
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9224
const MAX_TABS = 60

/**
 * The date used for the booking-grid pages.
 *
 * Fixed rather than "today" so a run is comparable with the last one. It sits
 * inside the seeded fortnight and on a weekday the whole clinic works.
 */
const GRID_DATE = process.env.SWEEP_DATE ?? '2026-08-26'

const PAGES = [
  ['homepage', '/'],
  ['step1-service', '/book'],
  ['step2-practitioner', '/book/initial-assessment'],
  ['step3-time', `/book/initial-assessment/nadia-okafor?date=${GRID_DATE}`],
  ['step3-any', `/book/initial-assessment/any?date=${GRID_DATE}`],
  ['staff', '/staff'],
]

const profile = join(tmpdir(), 'a11y-sweep-' + process.pid)
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--window-size=1280,900',
  '--no-first-run',
  'about:blank',
])

/** Chrome needs a moment before its debugging endpoint answers. */
async function endpoint() {
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

/** A minimal CDP client. One in-flight map, one id counter, no dependencies. */
function connect(url) {
  const ws = new WebSocket(url)
  const pending = new Map()
  let id = 0

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiting = pending.get(message.id)
    if (!waiting) return
    pending.delete(message.id)
    if (message.error) waiting.reject(new Error(message.error.message))
    else waiting.resolve(message.result)
  })

  return {
    ws,
    ready: new Promise((resolve) => ws.addEventListener('open', resolve)),
    send(method, params = {}, sessionId) {
      id += 1
      const payload = {id, method, params}
      if (sessionId) payload.sessionId = sessionId
      ws.send(JSON.stringify(payload))
      return new Promise((resolve, reject) => pending.set(id, {resolve, reject}))
    },
  }
}

const axeSource = readFileSync(AXE, 'utf8')

const root = connect(await endpoint())
await root.ready

const {targetId} = await root.send('Target.createTarget', {url: 'about:blank'})
const {sessionId} = await root.send('Target.attachToTarget', {targetId, flatten: true})
const send = (m, p) => root.send(m, p, sessionId)

await send('Page.enable')
await send('Runtime.enable')
await send('Accessibility.enable')

async function evaluate(expression) {
  const {result, exceptionDetails} = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate failed')
  return result.value
}

async function goto(url) {
  const loaded = new Promise((res) => {
    const h = (e) => {
      const m = JSON.parse(e.data)
      if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) {
        root.ws.removeEventListener('message', h)
        res()
      }
    }
    root.ws.addEventListener('message', h)
  })
  await send('Page.navigate', {url})
  await loaded
  // Fonts and hydration: the focus ring is a computed style, the tab order
  // depends on the DOM being final, and the roving tabindex is React's.
  await new Promise((r) => setTimeout(r, 1800))
}

/** Press a key as a real keyboard would, so :focus-visible actually matches. */
async function press(key, code, vk) {
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
  if (key === 'Enter') {
    await send('Input.dispatchKeyEvent', {
      type: 'char',
      key,
      code,
      text: '\r',
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
    })
  }
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
  await new Promise((r) => setTimeout(r, 60))
}

/**
 * The accessible name Chrome actually computed for whatever has focus.
 *
 * Not `textContent`, and not `innerText`. Those two disagree with the
 * accessible name exactly where it matters — around visually-hidden spans and
 * block-level children, which is precisely how the slot buttons are built —
 * and a probe that guessed would be reassuring rather than useful. This asks
 * the browser's own accessibility tree, which is the thing a screen reader
 * reads.
 */
async function accessibleName() {
  const {result} = await send('Runtime.evaluate', {expression: 'document.activeElement'})
  if (!result.objectId) return null
  try {
    const {nodes} = await send('Accessibility.getPartialAXTree', {
      objectId: result.objectId,
      fetchRelatives: false,
    })
    const node = nodes?.[0]
    return {
      name: node?.name?.value ?? null,
      role: node?.role?.value ?? null,
      disabled: node?.properties?.find((p) => p.name === 'disabled')?.value?.value ?? false,
    }
  } finally {
    await send('Runtime.releaseObject', {objectId: result.objectId}).catch(() => {})
  }
}

const tab = () => press('Tab', 'Tab', 9)
const enter = () => press('Enter', 'Enter', 13)
const arrow = (which) =>
  press(
    'Arrow' + which,
    'Arrow' + which,
    {Left: 37, Up: 38, Right: 39, Down: 40}[which],
  )

/**
 * Everything interesting about wherever focus currently is. The name is built
 * the way a screen reader would build it rather than read off textContent,
 * because those two disagree exactly where the bugs are.
 */
const DESCRIBE_FOCUS = String.raw`(() => {
  const el = document.activeElement
  if (!el || el === document.body) return {none: true}
  const cs = getComputedStyle(el)
  const labelledby = el.getAttribute('aria-labelledby')
  // A form control's name usually comes from its <label for>, which nothing
  // above would find -- and reporting a properly labelled field as "silent"
  // sends the manual pass after a bug that is not there.
  const labelFor = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null
  const name = (
    el.getAttribute('aria-label') ||
    (labelledby && document.getElementById(labelledby)
      ? document.getElementById(labelledby).textContent
      : '') ||
    (labelFor ? labelFor.textContent : '') ||
    el.innerText ||
    el.textContent ||
    el.getAttribute('title') ||
    el.getAttribute('alt') ||
    ''
  ).replace(/\s+/g, ' ').trim()
  const r = el.getBoundingClientRect()
  return {
    tag: el.tagName.toLowerCase(),
    href: el.getAttribute('href') || null,
    name: name.slice(0, 110),
    ariaHidden: !!el.closest('[aria-hidden="true"]'),
    ariaDisabled: el.getAttribute('aria-disabled') === 'true',
    inSlotGrid: !!el.closest('form [role], form ul') && el.tagName === 'BUTTON'
      && /^\d{2}:\d{2}/.test((el.textContent || '').trim()),
    tabIndex: el.tabIndex,
    outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
    ring: !(cs.outlineStyle === 'none' || cs.outlineWidth === '0px'),
    size: [Math.round(r.width), Math.round(r.height)],
    id: el.id || null,
  }
})()`

const HEADINGS = String.raw`Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => {
  const cs = getComputedStyle(h)
  return {
    level: Number(h.tagName[1]),
    text: h.innerText.replace(/\s+/g, ' ').trim().slice(0, 70),
    visuallyHidden: cs.clipPath === 'inset(50%)' || cs.clip === 'rect(0px, 0px, 0px, 0px)',
  }
})`

/** The state of the slot grid as markup, before a key is pressed. */
const GRID_SHAPE = String.raw`(() => {
  const items = Array.from(document.querySelectorAll('form li > button'))
  if (items.length === 0) return null
  const roving = items.filter(b => b.tabIndex === 0)
  return {
    total: items.length,
    bookable: items.filter(b => b.type === 'submit').length,
    unavailable: items.filter(b => b.getAttribute('aria-disabled') === 'true').length,
    // A composite widget has exactly one tab stop. More than one means the
    // roving tabindex is not roving; none means the grid cannot be reached.
    tabStops: roving.length,
    // Every unavailable slot must still be reachable by arrow key, which
    // means it must not carry the disabled attribute.
    unavailableThatAreHardDisabled: items.filter(
      b => b.getAttribute('aria-disabled') === 'true' && b.disabled,
    ).length,
    // Unavailable slots must not be able to submit the form.
    unavailableThatCouldSubmit: items.filter(
      b => b.getAttribute('aria-disabled') === 'true' && b.type === 'submit',
    ).length,
    firstNames: items.slice(0, 3).map(b => b.textContent.replace(/\s+/g, ' ').trim()),
  }
})()`

const results = []

for (const [label, path] of PAGES) {
  const url = BASE + path
  await goto(url)
  const page = {label, url}

  page.headings = await evaluate(HEADINGS)
  page.gridShape = await evaluate(GRID_SHAPE)

  // Skip link. Tab once to reach it, activate it, then check focus actually
  // moved into <main>. A link that only scrolls is the classic failure.
  await evaluate(
    'window.scrollTo(0,0); if (document.activeElement) document.activeElement.blur();',
  )
  await tab()
  page.firstStop = await evaluate(DESCRIBE_FOCUS)

  if (/skip/i.test(page.firstStop.name ?? '')) {
    await enter()
    await new Promise((r) => setTimeout(r, 400))
    page.skipLinkMovesFocus = await evaluate(
      '(() => { const m = document.getElementById("main"); ' +
        'return !!(m && document.activeElement && ' +
        '(m === document.activeElement || m.contains(document.activeElement))); })()',
    )
  }

  // The full tab order, from the top.
  //
  // Reload rather than blur. Activating the skip link moves the sequential
  // focus navigation starting point into <main>, and blur() does not put it
  // back — so tabbing from here would silently skip the header and the nav,
  // which are the first things a keyboard user meets. Only a fresh document
  // resets it.
  await goto(url)
  const stops = []
  const seen = new Set()
  for (let i = 0; i < MAX_TABS; i++) {
    await tab()
    const stop = await evaluate(DESCRIBE_FOCUS)
    if (stop.none) break
    Object.assign(stop, {ax: await accessibleName()})
    const key = stop.tag + '|' + stop.href + '|' + stop.name
    if (seen.has(key) && stops.length > 3) break
    seen.add(key)
    stops.push(stop)
  }

  page.tabStops = stops.length
  // Silent means silent to the accessibility tree, which is the only reader
  // whose opinion counts.
  page.silentStops = stops.filter((s) => !s.ax?.name)
  page.stopsInsideAriaHidden = stops.filter((s) => s.ariaHidden)
  page.stopsWithNoRing = stops.filter((s) => !s.ring)
  page.targetsUnder24px = stops.filter((s) => s.size[1] > 0 && s.size[1] < 24)
  page.order = stops.map((s) => s.ax?.name || '(no accessible name)')

  // Arrow keys inside the grid. Tab to the first slot, then walk right and
  // down and check focus lands somewhere new and still inside the grid.
  if (page.gridShape) {
    await goto(url)
    const walk = []
    for (let i = 0; i < MAX_TABS; i++) {
      await tab()
      const stop = await evaluate(DESCRIBE_FOCUS)
      if (stop.none) break
      if (/^\d{2}:\d{2}/.test(stop.name ?? '')) {
        walk.push({key: 'Tab', ax: await accessibleName(), ariaDisabled: stop.ariaDisabled})
        break
      }
    }

    if (walk.length > 0) {
      for (const key of ['Right', 'Right', 'Down', 'Left', 'Up']) {
        await arrow(key)
        const stop = await evaluate(DESCRIBE_FOCUS)
        walk.push({key, ax: await accessibleName(), ariaDisabled: stop.ariaDisabled})
      }
      // One more Tab from inside the grid must leave it entirely, or the
      // roving tabindex is not doing its job.
      await tab()
      const after = await evaluate(DESCRIBE_FOCUS)
      const afterName = (await accessibleName())?.name ?? ''
      page.tabLeavesGrid = !/^\d{2}:\d{2}/.test(afterName)
      page.afterGrid = afterName
    }

    page.arrowWalk = walk
    page.arrowKeysMoveFocus =
      walk.length > 1 && new Set(walk.map((w) => w.ax?.name)).size > 1
    page.arrowsReachUnavailable = walk.some((w) => w.ariaDisabled)
  }

  await evaluate(axeSource + ';0')
  page.axeViolations = await evaluate(
    'axe.run(document, {resultTypes:["violations"]}).then(r => r.violations.map(v => ' +
      '({id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, ' +
      'first: v.nodes[0] && v.nodes[0].target ? v.nodes[0].target.join(" ") : ""})))',
  )

  results.push(page)
  process.stderr.write('  swept ' + label + '\n')
}

console.log(JSON.stringify(results, null, 2))

chrome.kill()
try {
  rmSync(profile, {recursive: true, force: true})
} catch {}
