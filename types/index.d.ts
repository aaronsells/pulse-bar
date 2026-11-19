export type Snapshot = {
  percent?: number
  tokens?: number
  window: number
  usd?: number
  hasUnknownPrice?: boolean
}

export type RunningTool = { id: string; tool: string; startedAt: number; agentId?: string }

export type LastTool = { tool: string; ms: number; isOk: boolean }

export type ThemeName = 'aurora' | 'ember' | 'ocean' | 'mono'

export type Prefs = {
  theme: ThemeName
  layout: 'full' | 'compact'
  showContext: boolean
  showCost: boolean
  showActivity: boolean
  isHidden: boolean
  contextWarn: number
  costWarn: number
}

export type Warned = { context: number[]; cost: number[] }

declare module 'claude-code' {
  interface PluginState {
    'pulse-bar': {
      snapshot: Shaped<Snapshot | null>
      running: Shaped<RunningTool[]>
      last: Shaped<LastTool | null>
      toolCount: number
      tick: number
      agents: string[]
      prefs: Shaped<Prefs>
      warned: Shaped<Warned>
    }
  }
}
