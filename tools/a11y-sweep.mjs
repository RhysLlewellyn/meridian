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
  // Step 4 was never swept, which is the step with the only form in the flow
  // and therefore the labels, the hints and the error wiring.
  [
    'step4-details',
    `/book/initial-assessment/nadia-okafor/details?date=${GRID_DATE}&time=10:00`,
  ],
  ['staff', '/staff'],
  // The 404, which exists as of today and is the page a stale link lands on.
  ['not-found', '/no-such-page'],
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

/**
 * Resize the viewport without restarting Chrome.
 *
 * `--window-size` is set once at launch, so until this existed the sweep had
 * exactly one width and no way to ask for another. `mobile: true` matters as
 * much as the numbers: it is what makes `pointer: coarse` match, and the touch
 * targets in this build size themselves behind that media query.
 */
async function setViewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  })
  // `maxTouchPoints` must be 1-16 whether or not touch is enabled; passing 0
  // to turn it off is rejected outright rather than ignored.
  await send('Emulation.setTouchEmulationEnabled', {enabled: mobile, maxTouchPoints: 5})
  // Let the reflow settle before anything measures it.
  await new Promise((r) => setTimeout(r, 350))
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
    /*
      Whether this is a link sitting inside a sentence, which WCAG 2.5.8
      exempts from the minimum target size. Without it the size checks report
      "Change the time" on the details step -- 116x17, mid-paragraph, exactly
      what the exemption is written for -- and a checker that cries wolf on a
      compliant page teaches whoever reads it to skim the list.
    */
    inlineInText: (() => {
      if (cs.display !== 'inline') return false
      const parent = el.parentElement
      if (!parent) return false
      const around = (parent.innerText || '').trim().length
      const own = (el.innerText || '').trim().length
      return around > own + 20
    })(),
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

/**
 * What only goes wrong on a phone.
 *
 * Ported from Ledger, where the same two probes at 360 found a chart axis drawn
 * outside the viewport and six scrollable regions a keyboard could not reach --
 * none of which axe reported, because axe's own rules only fire at a width
 * where the region actually overflows, and that sweep only ran at 1280.
 *
 * Both probes are written to be capable of returning something, which is the
 * part that matters. The check they replace in Ledger was
 * `documentElement.scrollWidth > innerWidth`, and it could not fail:
 * `overflow-x: clip` pins `scrollWidth` to `clientWidth` by definition, so it
 * reported "no sideways scroll" for three months on a page that was drawing
 * content off-screen. Meridian has no `clip` rule and the same question is
 * still the wrong one here for the opposite reason -- `documentElement`
 * .`scrollWidth` reads 609 on a 390px `/staff` while `window.scrollX` never
 * leaves 0, so the document "overflows" by an amount nobody can scroll to.
 *
 * The right question is not whether the document scrolls. It is whether
 * anything is unreachable: wider than the viewport, with no ancestor that
 * scrolls to it.
 */
const NARROW = String.raw`(() => {
  /*
    The viewport width, and not from 'window.innerWidth'.

    Under Chrome's mobile emulation 'innerWidth' is the layout viewport, and
    Chrome widens that to fit content it cannot shrink. Measured on this build
    at 360x780: '/staff' reports innerWidth 601 while documentElement
    .clientWidth, body.scrollWidth and visualViewport.width are all 360. Every
    other page reports 360 for all four.

    That is not a curiosity, it is the bug this probe was about to ship with.
    The overflow test compares each element's right edge against the viewport,
    so on '/staff' -- the one page here with a table wider than a phone, and
    therefore the likeliest page in the build to have something unreachable --
    the threshold would have been 241px too generous. A check that cannot fail
    on the page it was written for.

    'documentElement.clientWidth' is the CSS layout viewport and reads 360
    everywhere.
  */
  const vw = document.documentElement.clientWidth

  const scrolls = (el) => {
    const cs = getComputedStyle(el)
    return (
      (cs.overflowX === 'auto' || cs.overflowX === 'scroll') &&
      el.scrollWidth > el.clientWidth + 1
    )
  }

  return {
    viewport: vw,
    // Kept alongside so a future divergence is visible rather than silent.
    innerWidth: window.innerWidth,

    // Content past the right edge with nowhere to scroll to it.
    unreachableOverflow: (() => {
      const out = []
      for (const el of document.querySelectorAll('main *')) {
        const box = el.getBoundingClientRect()
        if (box.width === 0 || box.right <= vw + 1) continue
        // Leaves only, so one wide table does not report every cell inside it.
        if (el.querySelector('*')) continue
        let scroller = null
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (scrolls(p)) { scroller = p; break }
        }
        if (!scroller) {
          out.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().slice(0, 40),
            right: Math.round(box.right),
            viewport: vw,
          })
        }
      }
      return out.slice(0, 12)
    })(),

    /*
      Scrollable regions a keyboard cannot reach.

      A div with 'overflow-x: auto' scrolls with a mouse and not with a
      keyboard, because Chrome only gives arrow keys to a scroller that can
      take focus. A region holding its own focusable children is exempt --
      tabbing to them scrolls it -- which is why the schedule table, whose rows
      each carry an Open link, is not reported here.
    */
    unfocusableScrollers: Array.from(document.querySelectorAll('main *'))
      .filter((el) => {
        const cs = getComputedStyle(el)
        if (cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') return false
        if (el.scrollWidth <= el.clientWidth + 1) return false
        if (el.tabIndex >= 0) return false
        return !el.querySelector('a[href], button, input, select, textarea, [tabindex]')
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute('aria-label'),
        overflowBy: el.scrollWidth - el.clientWidth,
      })),

    /*
      Touch targets, measured where a thumb is actually the pointer.

      The controls in this build size themselves behind 'pointer: coarse', so
      the 1280 pass cannot see the height a phone gets -- it sees the desk
      density, which is deliberate and different. Anything narrower than 44px
      is skipped rather than reported: that is an inline link inside a
      sentence, which WCAG 2.5.8 exempts, and reporting it would train whoever
      reads this to ignore the list.
    */
    targetsUnder44px: Array.from(
      document.querySelectorAll('main a[href], main button, main input, main summary'),
    )
      .map((el) => {
        const r = el.getBoundingClientRect()
        /*
          WCAG 2.5.8 exempts a link inside a block of text, and the exemption
          has to be detected rather than guessed at. An earlier version of this
          filter used width as the proxy -- anything under 44px wide is
          probably inline -- and it was wrong on the first page it met:
          "Change the time" on the details step is 116px wide and 17 tall,
          sitting mid-sentence, and got reported as a defect it is not.

          The real test is whether the link is inline and the text around it is
          more than the link itself.
        */
        const parent = el.parentElement
        const parentText = parent ? (parent.innerText || '').trim() : ''
        const ownText = (el.innerText || '').trim()
        const inlineInText =
          getComputedStyle(el).display === 'inline' &&
          parentText.length > ownText.length + 20

        return {
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30),
          w: Math.round(r.width),
          h: Math.round(r.height),
          inlineInText,
        }
      })
      .filter((t) => t.h > 0 && t.h < 44 && !t.inlineInText)
      .slice(0, 12),
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
  // WCAG 2.5.8 asks 24x24 of a target, and exempts a link inside a block of
  // text. The exemption is honoured here rather than left for a human to
  // re-derive every time the sweep runs.
  page.targetsUnder24px = stops.filter(
    (s) => s.size[1] > 0 && s.size[1] < 24 && !s.inlineInText,
  )
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

  /*
    The same page again at 360.

    Last, because everything above it -- the tab walk, the skip link, the
    roving tabindex inside the grid -- is measured at the width this build was
    designed at, and resizing mid-walk would invalidate it.

    A fresh navigation after the resize rather than a reflow into it. The rail
    switches from a column to a row, the slot grid is `auto-fill`, and the
    schedule table's scroll hint appears below 40rem: a layout built at 360 and
    a layout dragged down to 360 are not reliably the same thing, and the one
    worth measuring is the one a phone actually gets.
  */
  await setViewport(360, 780, true)
  await goto(url)
  page.narrow = await evaluate(NARROW)
  await evaluate(axeSource + ';0')
  page.narrowAxeViolations = await evaluate(
    'axe.run(document, {resultTypes:["violations"]}).then(r => r.violations.map(v => ' +
      '({id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, ' +
      'first: v.nodes[0] && v.nodes[0].target ? v.nodes[0].target.join(" ") : ""})))',
  )
  await setViewport(1280, 900, false)

  results.push(page)
  process.stderr.write(
    '  swept ' + label +
      ' (1280: ' + page.axeViolations.length + ' violations, 360: ' +
      page.narrowAxeViolations.length + ')' + String.fromCharCode(10),
  )
}

console.log(JSON.stringify(results, null, 2))

chrome.kill()
try {
  rmSync(profile, {recursive: true, force: true})
} catch {}
