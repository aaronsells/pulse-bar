import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'pulse-bar',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

const run = (args: string) => ({
  command: 'statusbar',
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 120 },
})

const USAGE = {
  startedAt: 0,
  context: { tokens: 170_000, window: 200_000, percent: 85 },
  rateLimits: [],
  cost: { usd: 6.5 },
}

// Stand in for the engine beneath the plugin.
function engine(on: any, toasts: string[], own: { clock?: boolean; tool?: boolean } = {}) {
  on('command.register', () => ({ value: { command: 'statusbar' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: USAGE }))
  on('ui.toast', (_: unknown, e: { text?: string; message?: string }) => {
    toasts.push(String(e.text ?? e.message ?? JSON.stringify(e)))
    return { value: undefined }
  })
  if (!own.tool) on('tool.call', () => ({ result: {} }))
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  let now = 1_000
  if (!own.clock) on('clock.now', () => ({ value: (now += 250) }))
}

test('the band shows context, cost and the last tool on every surface', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /^85%$/ }))?.text).toBe('85%')
    expect((await ui.find({ type: 'Text', text: /\$6\.50/ }))?.text).toBe('$6.50')
    expect((await ui.find({ type: 'Text', text: /last Bash/ }))?.text).toMatch(/1 tool/)
    await ui.unmount()
  }
})

test('crossing the thresholds toasts once each', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/x' })

  expect(toasts.some(t => /Context passed 80%/.test(t))).toBe(true)
  expect(toasts.some(t => /cost passed \$5\.00/.test(t))).toBe(true)
  expect(toasts.filter(t => /Context passed 80%/.test(t)).length).toBe(1)
})

test('/statusbar switches layout, theme and sections', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const compact = await $.command.run(run('compact'))
  expect(JSON.stringify(compact)).toMatch(/compact/)
  const theme = await $.command.run(run('theme ember'))
  expect(JSON.stringify(theme)).toMatch(/ember/)
  const bad = await $.command.run(run('theme neon'))
  expect(JSON.stringify(bad)).toMatch(/Unknown theme/)
  await $.command.run(run('hide cost'))

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const line = await ui.find({ type: 'Text', text: /ctx/ })
  expect(line?.text).toMatch(/85%/)
  expect(line?.text).not.toMatch(/\$6\.50/)
  await ui.unmount()
})

test('/statusbar off hides the band', async ($, on) => {
  engine(on, [])
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(run('off'))

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('a running tool shows a live timer, then its final duration', async ($, on) => {
  engine(on, [], { clock: true, tool: true })
  const clock = mock.clock(on, { now: 50_000 })
  // The tool takes 20 seconds of mocked time.
  on('tool.call', async () => {
    await clock.sleep(20_000)
    return { result: {} }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pending = $.tool.call({ tool: 'Bash', command: 'sleep 20' })
  await clock.advance(12_000)

  for (const surface of ['terminal', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /▶/ }))?.text).toMatch(/▶ Bash 12s/)
    await ui.unmount()
  }

  await clock.advance(8_000)
  await pending
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const line = (await after.find({ type: 'Text', text: /last Bash/ }))?.text
  expect(line).toMatch(/last Bash 20\.0s ✓/)
  expect(line).not.toMatch(/▶/)
  await after.unmount()
})

test('elapsed time reads in minutes past a minute', async ($, on) => {
  engine(on, [], { clock: true, tool: true })
  const clock = mock.clock(on, { now: 0 })
  on('tool.call', async () => {
    await clock.sleep(130_000)
    return { result: {} }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pending = $.tool.call({ tool: 'Agent', prompt: 'x', description: 'x', subagent_type: 'general-purpose' } as never)
  await clock.advance(125_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /▶/ }))?.text).toMatch(/▶ Agent 2m 05s/)
  await ui.unmount()

  await clock.advance(5_000)
  await pending
})
