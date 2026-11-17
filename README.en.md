# Autopilote — autonomous mode for Claude Code

Give Claude a **goal**; Autopilote keeps it working on its own until the goal is met. Claude splits the goal into tasks, does them one by one, checks each one, adds new tasks when the list runs out, and stops when the goal is reached. Autopilote watches your Claude plan usage (5-hour window and week) and **spreads your usage** instead of burning it all at once.

(The in-app interface and messages are in French. [Version française](README.md).)

## Where it works

- **Yes**: Claude Code 2.1.320 or later (`claude --version`, otherwise `claude update`): terminal, the Code tab of the desktop app, VS Code and JetBrains extensions.
- **No**: claude.ai chat and the mobile apps on their own (no plugins there).
- **Usage pacing** needs a Claude subscription login (Pro or Max). With an API key, Bedrock or Vertex it still works, but relaunches at every interval without pacing.

## Install

In a Claude Code session:

```
/plugin marketplace add skylors-prems/autopilote
/plugin install autopilote@autopilote
```

Or just ask Claude: "install the autopilote plugin from github skylors-prems/autopilote".

## Use

1. Open Claude Code in your project folder.
2. `/autopilote objectif <your goal>`: creates `AUTOPILOTE.md` (status, goal, rules, tasks, "to validate" section, log).
3. `/autopilote on`.

Each relaunch: Claude takes the first unchecked task, does it, verifies it, checks it, logs it, makes a local commit if the project uses git. Empty list but goal not met → it adds 3 to 8 tasks. Goal met → "Statut : terminé" and Autopilote stops. Blocked on a decision only you can make → "Statut : bloqué", pause.

Already have a task list (`TODO.md` with checkboxes)? Set it as the "Fichier de suivi" (tracking file) setting.

| Command | Effect |
|---|---|
| `/autopilote` | open the panel (project, usage, settings, log) |
| `/autopilote objectif <text>` | create the tracking file or change the goal |
| `/autopilote on` / `off` | start / pause |
| `/autopilote maintenant` | relaunch now |
| `/autopilote etat` | one-line summary |

Settings (panel or `/config`): interval (15 min), tracking file, extra instructions, pacing (week / 5h / none), weekly target (90 %), 5-hour ceiling (95 %), tolerated lead (3 points), start with every session.

## Privacy

- Your login is only sent to `api.anthropic.com`, through an opaque handle: the plugin never sees the token.
- Every relaunch tells Claude not to write personal data (names, addresses, emails, passwords, keys) into files or commits, and not to send, publish or push anything you did not ask for. No telemetry, no third-party server.
- The usage endpoint is not officially documented: if it changes, Autopilote keeps working without pacing.

## Credits

Written with [Claude](https://claude.com/claude-code) (Anthropic). MIT license.
