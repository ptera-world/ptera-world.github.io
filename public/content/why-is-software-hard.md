# Why is software hard?

You're not bad at computers. Software is actually hard to use.

You know the app can do the thing. You've done it before. [You just can't find it.](#why-cant-you-find-anything) And maybe [that's on purpose](#is-complexity-intentional) - because the [people making these decisions](#who-decides-how-software-works) aren't living with the consequences. The whole paradigm [froze decades ago](#why-hasnt-it-changed) before anyone questioned whether it was good. It [doesn't value your time](#does-it-respect-your-time). But some software [feels completely different](#what-does-good-software-feel-like) - which proves it's possible. So [what can you do](#what-can-you-do)? And [what's really going on underneath](#whats-the-deeper-problem)?

## Why can't you find anything?

You know the app can do something. You've done it before. You just can't find it.

Menu hunting. File, Edit, View, Tools - where is it? Each app organizes differently. The answer is "memorize the arbitrary structure" or "hunt every time."

Modifier key mystery. Ctrl+K does something. Ctrl+Shift+K does something else. How would you know? Nobody tells you.

Settings sprawl. Somewhere in Preferences, General, Advanced, (scroll), (scroll) is the thing you want. Probably.

The pattern: software has capabilities, but won't tell you what they are. You hunt. You guess. You Google. You watch tutorials for apps you've used for years.

This isn't your fault. It's a design choice. The functionality is *hidden* - buried in menus, implicit in code, never surfaced. There's no way to ask "what can I do here?"

## Is complexity intentional?

Complexity as moat. If software is hard to learn, it's hard to leave. You've invested in mastering the hiding places. Switching costs are high. Some companies benefit from this.

Features as marketing. More checkboxes on the comparison page. Doesn't matter if they make the app worse to use - they make it easier to sell. Features accumulate. Nobody removes them.

The result: bloated software that does everything, where finding anything takes expertise. And when someone asks how to do something, the answer is often ["just..."](https://www.todepond.com/wikiblogarden/better-computing/just/) - a word that hides an entire iceberg of assumed knowledge.

## Who decides how software works?

Software is built by engineers. Engineers optimize for what engineers value: features, flexibility, power. Not simplicity, not learnability, not "can my mom use this?"

Interaction design - thinking carefully about how humans actually use things - is dismissed as "not real engineering." So it doesn't get engineering effort.

And when designers *are* involved, they're often overruled by product managers optimizing for metrics, or executives who want feature parity with competitors.

The people building the software aren't the people using it. And the incentives don't align.

## Why hasn't it changed?

The way software works - windows, icons, menus, clicking - was invented in the 1970s. It was revolutionary then.

Then it froze. The paradigm calcified before anyone questioned whether it was actually good. We've been doing the same thing for 50 years, adding features on top, never rethinking the foundation.

Worse: the toolkits locked it in. Windows gives developers `CreateMenu()` but not `CreateRadialMenu()`. So everyone uses linear menus - not because they're better, but because they're *there*.

We once had spatial interfaces (the original Mac Finder remembered where each folder's window was). We threw them away for "efficiency." We once had HyperCard - anyone could build interactive things. Apple neglected it to death. The dream of "everyone can make software" died with it.

We inherited the paradigm, not the reasoning behind it.

## Does it respect your time?

Good software values your hours. Bad software wastes them to inflate metrics.

- Notifications that demand attention for things that don't matter
- Engagement loops designed to keep you in the app
- Updates that move things around so you have to relearn
- Loading screens, splash screens, "what's new" screens
- Features that require clicking through five dialogs

None of this helps you do what you came to do. It helps the software company hit their numbers.

## What does good software feel like?

It exists. You've probably used some. It feels different:

- You can find things
- It tells you what's possible
- New features don't break old workflows
- It loads fast and gets out of your way
- It respects that you have other things to do
- You get better at it over time, and it rewards that

This isn't magic. It's choices. Someone decided to prioritize your experience over their metrics.

## What can you do?

**Recognize it's not you.** When software is frustrating, the frustration is valid. It's not a skill issue - it's a design issue.

**Look for command palettes.** Ctrl+K or Cmd+Shift+P in many apps opens a searchable list of everything the app can do. It's the closest thing to "just tell me what's possible."

**Notice when software respects you.** When something feels good to use, that's not accident. Someone made choices. Reward those choices with your attention.

**Accept that expertise is contextual.** Being good at one app doesn't transfer. Each app has its own arbitrary hiding places. You're not dumb for not knowing them.

## What's the deeper problem?

Software is hard because the people building it benefit from it being hard, or don't prioritize it being easy, or simply don't know how to make it easier.

This isn't inevitable. Different incentives produce different software. The tools that feel good to use prove it's possible. The question is why they're the exception rather than the rule.

## See also

- [what's actually wrong?](/whats-actually-wrong) - the broader context of what's actually wrong
- [dusklight](/dusklight) - UI that surfaces affordances instead of hiding them
- [keybinds](/keybinds) - making keyboard shortcuts discoverable
- [normalize](/normalize) - CLI that exposes structure instead of hiding it
