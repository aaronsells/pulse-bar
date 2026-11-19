# pulse-bar

A status band above the Claude Code prompt. It shows a context window meter with token counts, the session's running cost, and live activity: each running tool with a live timer (for example `▶ Bash 12s`), the last tool with its duration and whether it succeeded, the number of running subagents, and the total number of tool calls. Toasts warn you when context passes 80% and 95%, and when cost passes a threshold ($5 by default, again at 2x and 4x).

## /statusbar

| Command | Effect |
| --- | --- |
| `/statusbar` | Show settings and current figures |
| `/statusbar show\|hide context\|cost\|activity\|all` | Turn sections on or off |
| `/statusbar on\|off` | Show or hide the whole band |
| `/statusbar compact\|full` | One-line layout, or the full layout |
| `/statusbar theme aurora\|ember\|ocean\|mono\|next` | Color theme (or press the ◐ button in the band, hotkey `t` when the band has focus) |
| `/statusbar warn context <pct>` | Context toast threshold (0 = off) |
| `/statusbar warn cost <usd>` | Cost toast threshold (0 = off) |
| `/statusbar reset` | Restore defaults |

Settings are saved in the plugin store and carry over between sessions.
Cost is Claude Code's own estimate (the same figure as /cost), not your bill.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install pulse-bar --marketplace aaronsells/pulse-bar
```

Answer `y` to add the marketplace, then pick a scope (user scope is first; press Enter).

From a shell:

```bash
claude plugin install pulse-bar --marketplace aaronsells/pulse-bar
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `aaronsells/pulse-bar`, then Add plugin.

## License

MIT. See [LICENSE](LICENSE).
