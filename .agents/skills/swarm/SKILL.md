---
name: swarm
description: 'Launch the yandex-metrika-analyse-dashboard agent swarm: tasks from Linear (workspace analitics-platform, team ANA, state Todo + label `swarm`) are carried automatically through develop → gates → review → document → release (PR, CI, version, tag, GitHub Release) → Linear Done. Use when the user says «запусти рой», «запусти навык Рой», «run the swarm», «swarm run», «подхвати роем», or asks to process swarm-labeled Linear tasks.'
---

# Swarm run

You are launching the agent swarm of this repository. The machinery lives in
`scripts/swarm/` (orchestrator + role prompts, architecture in `scripts/swarm/README.md`).
Your job is to preflight, launch, babysit, and report — the orchestrator does the rest.

## 1. Preflight (all must pass)

```bash
git status --porcelain               # must be EMPTY
git rev-parse --abbrev-ref HEAD      # must be `main`
git fetch origin && git rev-parse HEAD origin/main   # local main must not be behind
opencode --version                   # the worker CLI must exist
gh auth status                       # push/PR access to origin
```

If the tree is dirty, commit or stash FIRST (never launch the swarm on a dirty tree — it
self-checks and aborts). If tasks should come from a queue of N, note the user's N (default 1).

## 2. Launch

```bash
node scripts/swarm/orchestrator.mjs --max <N> 2>&1 | tee /tmp/swarm-run-$(date +%H%M).log
```

- Flags you may pass through: `--max N` (tasks this run), `--rounds N` (dev/review rounds,
  default 3), `--dry-run` (pick + plan only), `--no-release` (stop after review ACCEPT).
- Run it in the background; stream the log to the user (`tail -f` path) — the user asked
  to see the trace in real time.
- LOOP MODE («сделай в loop до идеального результата»): run with a generous `--max`; when a
  run ends, re-check the queue (any Todo + `swarm` left?) and relaunch until
  `SWARM_PICK::NONE`. Between runs, read failure comments on Linear and fix forward.

## 3. Babysit (the swarm talks through its log)

Milestones to relay: `picked <ID>` → claim → `round n: develop` → `gates green` →
`verdict: ACCEPT|RETURN` → `story:` → `merged:` → release chain (`vX.Y.Z`, CI+E2E green,
Release published) → `=== DONE ===`. Read `.task-board/log/cycle-*.log` for worker tails.

## 4. On failure — fix forward, do not shrug

1. Read the latest `.task-board/log/*.log` and the failed issue's Linear comments.
2. Classify: **orchestrator bug** → fix it red-first (extend `scripts/swarm/orchestrator.test.mjs`),
   commit, push, watch CI, relaunch. **Task-side problem** (ambiguous issue, scope creep)
   → report to the user, leave the issue In Progress — never fabricate a close.
3. Known landmines: no `git push` without explicit `origin main`; never run from a
   non-`main` branch; all workers run `opencode run --auto` (owner-directed autonomy);
   the clerk must only touch the analitics-platform workspace.

## 5. Report

When the run ends, summarize in the user's language (RU): which issues were picked, what
shipped (version, PR, CI/E2E/Release runs, stories), what was closed and why. Linear is
the source of truth — quote its final states. In loop mode, report per-cycle and keep
going until the queue is empty or the user says stop.
