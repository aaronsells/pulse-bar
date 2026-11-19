import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { LastTool, Prefs, RunningTool, Snapshot, ThemeName, Warned } from '../types'

const P = 'pulse-bar'
const STORE_PREFS = 'prefs'

const DEFAULT_PREFS: Prefs = {
  theme: 'aurora',
  layout: 'full',
  showContext: true,
  showCost: true,
  showActivity: true,
  isHidden: false,
  contextWarn: 80,
  costWarn: 5,
}

// Bump a shape tag when that value's fields change, so a reload declines the old value.
const snapshot = atom({ plugin: 'pulse-bar', key: 'snapshot' } as const, null, { shape: 'snap-1' })
const running = atom({ plugin: 'pulse-bar', key: 'running' } as const, [], { shape: 'run-1' })
const last = atom({ plugin: 'pulse-bar', key: 'last' } as const, null, { shape: 'last-1' })
const toolCount = atom({ plugin: 'pulse-bar', key: 'toolCount' } as const, 0)
// Bumped once a second while a tool runs, so the band redraws its timers.
const tick = atom({ plugin: 'pulse-bar', key: 'tick' } as const, 0)
const agents = atom({ plugin: 'pulse-bar', key: 'agents' } as const, [])
const prefs = atom({ plugin: 'pulse-bar', key: 'prefs' } as const, DEFAULT_PREFS, { shape: 'prefs-1' })
const warned = atom({ plugin: 'pulse-bar', key: 'warned' } as const, { context: [], cost: [] }, {
  shape: 'warned-1',
})

type Palette = { accent?: string; ok?: string; warn?: string; crit?: string; label?: string }

const THEMES: Record<ThemeName, Palette> = {
  aurora: { accent: '#a78bfa', ok: '#34d399', warn: '#fbbf24', crit: '#f87171', label: '#94a3b8' },
  ember: { accent: '#fb923c', ok: '#facc15', warn: '#f97316', crit: '#ef4444', label: '#a8a29e' },
  ocean: { accent: '#38bdf8', ok: '#2dd4bf', warn: '#fcd34d', crit: '#fb7185', label: '#7dd3fc' },
  mono: {},
}
const THEME_NAMES = Object.keys(THEMES) as ThemeName[]

// ---------- formatting ----------

const fmtTokens = (n?: number) =>
  n === undefined ? '?' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const fmtUsd = (usd?: number) =>
  usd === undefined ? 'n/a' : usd < 1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`

const fmtElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000)
  if (s < 1) return ''
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const fmtMs = (ms: number) =>
  ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 60_000)}m`

const bar = (percent: number, cells = 10) => {
  const full = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return '▰'.repeat(full) + '▱'.repeat(cells - full)
}

const levelColor = (pal: Palette, percent: number, warnAt: number) =>
  percent >= 95 ? pal.crit : percent >= warnAt ? pal.warn : pal.ok

// ---------- state helpers ----------

async function savePrefs($: EngineInterface, fn: (p: Prefs) => Prefs) {
  await update($, prefs, fn)
  await $.store.set(STORE_PREFS, await read($, prefs))
}

async function refresh($: EngineInterface) {
  const u = await $.session.usage()
  const snap: Snapshot = {
    percent: u.context.percent,
    tokens: u.context.tokens,
    window: u.context.window,
    usd: u.cost?.usd,
    hasUnknownPrice: u.cost?.hasUnknownPrice === true,
  }
  await update($, snapshot, () => snap)
  await checkThresholds($, snap)
}

async function checkThresholds($: EngineInterface, snap: Snapshot) {
  const p = await read($, prefs)
  const w = await read($, warned)
  const next: Warned = { context: [...w.context], cost: [...w.cost] }
  let changed = false

  const ctxLevels = [...new Set([p.contextWarn, 95])].filter(l => l > 0).sort((a, b) => a - b)
  for (const level of ctxLevels) {
    if ((snap.percent ?? 0) >= level && !next.context.includes(level)) {
      next.context.push(level)
      changed = true
      $.ui.toast(
        level >= 95
          ? `Context is ${snap.percent}% full. Consider /compact now.`
          : `Context passed ${level}% (${fmtTokens(snap.tokens)} of ${fmtTokens(snap.window)} tokens).`,
      )
    }
  }

  if (p.costWarn > 0 && snap.usd !== undefined) {
    for (const level of [p.costWarn, p.costWarn * 2, p.costWarn * 4]) {
      if (snap.usd >= level && !next.cost.includes(level)) {
        next.cost.push(level)
        changed = true
        $.ui.toast(`Session cost passed ${fmtUsd(level)} (now ${fmtUsd(snap.usd)}).`)
      }
    }
  }

  if (changed) await update($, warned, () => next)
}

// ---------- /statusbar ----------

const HELP = [
  '/statusbar                     show settings and current figures',
  '/statusbar show|hide <context|cost|activity|all>',
  '/statusbar on | off            show or hide the whole band',
  '/statusbar compact | full      switch layout',
  '/statusbar theme [name]        list or set a theme (' + THEME_NAMES.join(', ') + ')',
  '/statusbar warn context <pct>  context toast threshold (0 turns it off)',
  '/statusbar warn cost <usd>     cost toast threshold; also warns at 2x and 4x (0 turns it off)',
  '/statusbar reset               restore defaults',
].join('\n')

async function runCommand($: EngineInterface, args: string): Promise<string> {
  const [verb = '', a = '', b = ''] = args.trim().toLowerCase().split(/\s+/)
  const sections: Record<string, keyof Prefs> = {
    context: 'showContext',
    cost: 'showCost',
    activity: 'showActivity',
  }

  switch (verb) {
    case '':
    case 'status': {
      await refresh($)
      const p = await read($, prefs)
      const s = await read($, snapshot)
      return [
        `pulse-bar: ${p.isHidden ? 'hidden' : 'shown'}, ${p.layout} layout, ${p.theme} theme`,
        `sections: context ${p.showContext ? 'on' : 'off'}, cost ${p.showCost ? 'on' : 'off'}, activity ${p.showActivity ? 'on' : 'off'}`,
        `toasts: context at ${p.contextWarn || 'off'}${p.contextWarn ? '% and 95%' : ''}, cost at ${p.costWarn ? fmtUsd(p.costWarn) + ' (and 2x, 4x)' : 'off'}`,
        s ? `now: context ${s.percent ?? '?'}% (${fmtTokens(s.tokens)}/${fmtTokens(s.window)}), cost ${fmtUsd(s.usd)}` : 'now: no figures yet',
        '',
        HELP,
      ].join('\n')
    }
    case 'help':
      return HELP
    case 'on':
    case 'off':
      await savePrefs($, p => ({ ...p, isHidden: verb === 'off' }))
      return verb === 'off' ? 'Status band hidden. /statusbar on brings it back.' : 'Status band shown.'
    case 'show':
    case 'hide': {
      const value = verb === 'show'
      if (a === 'all') {
        await savePrefs($, p => ({ ...p, showContext: value, showCost: value, showActivity: value }))
        return `All sections ${value ? 'shown' : 'hidden'}.`
      }
      const key = sections[a]
      if (!key) return `Unknown section "${a}". Use context, cost, activity or all.`
      await savePrefs($, p => ({ ...p, [key]: value }))
      return `${a} ${value ? 'shown' : 'hidden'}.`
    }
    case 'compact':
    case 'full':
      await savePrefs($, p => ({ ...p, layout: verb }))
      return `Layout set to ${verb}.`
    case 'theme': {
      if (!a) return `Themes: ${THEME_NAMES.join(', ')}. Current: ${(await read($, prefs)).theme}.`
      if (!THEME_NAMES.includes(a as ThemeName)) return `Unknown theme "${a}". Pick one of ${THEME_NAMES.join(', ')}.`
      await savePrefs($, p => ({ ...p, theme: a as ThemeName }))
      return `Theme set to ${a}.`
    }
    case 'warn': {
      const n = Number(b.replace(/^\$/, '').replace(/%$/, ''))
      if (!Number.isFinite(n) || n < 0) return 'Give a number, for example /statusbar warn cost 2.5'
      if (a === 'context') {
        if (n > 100) return 'Context threshold is a percentage from 0 to 100.'
        await savePrefs($, p => ({ ...p, contextWarn: n }))
      } else if (a === 'cost') {
        await savePrefs($, p => ({ ...p, costWarn: n }))
      } else {
        return 'Use /statusbar warn context <pct> or /statusbar warn cost <usd>.'
      }
      await update($, warned, () => ({ context: [], cost: [] }))
      const s = await read($, snapshot)
      if (s) await checkThresholds($, s)
      return n === 0 ? `${a} toasts turned off.` : `${a} toast threshold set to ${a === 'cost' ? fmtUsd(n) : n + '%'}.`
    }
    case 'reset':
      await savePrefs($, () => DEFAULT_PREFS)
      await update($, warned, () => ({ context: [], cost: [] }))
      return 'Status band settings restored to defaults.'
    default:
      return `Unknown option "${verb}".\n\n${HELP}`
  }
}

// ---------- live timer ----------

// The module's own variable: a reload starts it over, and session.start clears it.
let ticker: Timer | null = null

function stopTicker() {
  ticker?.cancel()
  ticker = null
}

function startTicker($: EngineInterface) {
  if (ticker) return
  try {
    ticker = $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, running)
        if (list.length === 0) return stopTicker()
        await update($, tick, n => n + 1)
      })().catch(() => undefined)
    })
  } catch {
    ticker = null
  }
}

// ---------- hooks ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'statusbar',
      description: 'Configure the pulse-bar status band: sections, layout, theme, toast thresholds',
      argumentHint: '[show|hide|on|off|compact|full|theme|warn|reset] …',
    })
    const stored = (await $.store.get(STORE_PREFS)) as Partial<Prefs> | undefined
    if (stored && typeof stored === 'object') {
      const merged: Prefs = { ...DEFAULT_PREFS, ...stored }
      if (!THEME_NAMES.includes(merged.theme)) merged.theme = DEFAULT_PREFS.theme
      await update($, prefs, () => merged)
    }
    // A reload starts the module over; tools that were mid-flight are gone.
    await update($, running, () => [])
    stopTicker()
    await refresh($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'statusbar' }, async ($, e) => ({ text: await runCommand($, e.args) }))

  on('tool.call', async ($, e, next) => {
    const call: RunningTool = {
      id: e.tool_use_id || `${e.tool}-${await $.clock.now()}`,
      tool: String(e.tool),
      startedAt: await $.clock.now(),
      agentId: e.agentId,
    }
    await update($, running, list => [...list, call].slice(-20))
    startTicker($)
    let isOk = false
    try {
      const result = await next(e)
      isOk = !('deny' in result && result.deny) && !result.isError
      return result
    } finally {
      // Bookkeeping only: never let it disturb the tool's own result.
      try {
        const ms = Math.round((await $.clock.now()) - call.startedAt)
        const done: LastTool = { tool: call.tool, ms, isOk }
        await update($, running, list => list.filter(one => one.id !== call.id))
        if ((await read($, running)).length === 0) stopTicker()
        await update($, last, () => done)
        await update($, toolCount, n => n + 1)
        void refresh($).catch(() => undefined)
      } catch {
        // ignore
      }
    }
  })

  on('turn.start', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) await update($, agents, list => (list.includes(id) ? list : [...list, id]))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) await update($, agents, list => list.filter(one => one !== id))
    await refresh($).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, prefs)
    if (e.props.hasSurvey || p.isHidden) return next(e)
    if (!p.showContext && !p.showCost && !p.showActivity) return next(e)

    const { Box, Text, Progress } = $.ui.resolve(e)
    const pal = THEMES[p.theme]
    const s = await read($, snapshot)
    const live = await read($, running)
    const done = await read($, last)
    const count = await read($, toolCount)
    const agentList = await read($, agents)
    const pct = s?.percent ?? 0
    const ctxColor = levelColor(pal, pct, p.contextWarn || 101)
    const costHot = p.costWarn > 0 && (s?.usd ?? 0) >= p.costWarn
    const working = e.props.isWorking
    await read($, tick) // redraw on each tick
    const nowMs = live.length > 0 ? await $.clock.now() : 0

    const activityText = () => {
      const parts: string[] = []
      if (live.length > 0) {
        const shown = live.slice(-3).map(t => {
          const elapsed = fmtElapsed(nowMs - t.startedAt)
          return elapsed ? `${t.tool} ${elapsed}` : t.tool
        })
        const more = live.length > 3 ? ` +${live.length - 3}` : ''
        parts.push(`▶ ${shown.join(' · ')}${more}`)
      } else if (working) {
        parts.push('▶ thinking')
      }
      if (done) parts.push(`last ${done.tool} ${fmtMs(done.ms)} ${done.isOk ? '✓' : '✗'}`)
      if (agentList.length > 0) parts.push(`${agentList.length} agent${agentList.length === 1 ? '' : 's'}`)
      parts.push(`${count} tool${count === 1 ? '' : 's'}`)
      return parts.join(' · ')
    }

    if (p.layout === 'compact') {
      const bits: string[] = []
      if (p.showContext) bits.push(`ctx ${bar(pct, 8)} ${s?.percent ?? '?'}%`)
      if (p.showCost) bits.push(fmtUsd(s?.usd) + (s?.hasUnknownPrice ? '*' : ''))
      if (p.showActivity) bits.push(activityText())
      return (
        <Box>
          <Text color={pal.accent} bold>◆ </Text>
          <Text color={pal.label} wrap="truncate-end">{bits.join('  │  ')}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={3} alignItems="center">
        <Text color={pal.accent} bold>◆ pulse</Text>
        {p.showContext && (
          <Box key="ctx" flexDirection="row" columnGap={1} alignItems="center">
            <Text color={pal.label}>context</Text>
            {e.surface === 'terminal' ? (
              <Text color={ctxColor}>{bar(pct)}</Text>
            ) : (
              <Box width={14}>
                <Progress label="Context window" value={pct} max={100} color={ctxColor} />
              </Box>
            )}
            <Text color={ctxColor} bold tabular>{s?.percent === undefined ? '—' : `${s.percent}%`}</Text>
            <Text dimColor tabular>{fmtTokens(s?.tokens)}/{fmtTokens(s?.window)}</Text>
          </Box>
        )}
        {p.showCost && (
          <Box key="cost" flexDirection="row" columnGap={1}>
            <Text color={pal.label}>cost</Text>
            <Text color={costHot ? pal.warn : pal.ok} bold tabular>
              {fmtUsd(s?.usd)}
              {s?.hasUnknownPrice ? '*' : ''}
            </Text>
          </Box>
        )}
        {p.showActivity && (
          <Box key="act" flexDirection="row" columnGap={1} flexShrink={1}>
            <Text color={live.length > 0 || working ? pal.accent : pal.label} wrap="truncate-end">
              {activityText()}
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
