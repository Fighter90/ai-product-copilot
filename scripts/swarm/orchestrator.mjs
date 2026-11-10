#!/usr/bin/env node
// Swarm orchestrator — Linear(ANA) → EXECUTOR → TESTER(gates) → REVIEWER → DOCUMENTER →
// RELEASE MANAGER → Linear Done. All LLM roles run via `opencode run --auto` with role
// prompt templates (scripts/swarm/roles/*.md); every git/gh/pnpm step is deterministic
// code. See scripts/swarm/README.md (ru) for the architecture.
//
// ISOLATION (v2, lessons of runs 1-7): ALL cycle work happens in a dedicated git
// worktree `.swarm-worktree` — never in the user's checkout. The user's tree keeps
// their `data/` SQLite, `.env` tokens and possibly a live dev server; backend tests
// against that state fail in mass regardless of code quality (runs 4-7: 326 instant
// failures in 34 files; the same commits are 884/884 green in a clean checkout). The
// worktree is clean by construction — exactly the conditions where gates are honest.
// It also means operator commits to main can't be hijacked by the swarm's branch
// checkouts (run 7: the -B reset orphaned an operator commit and turned pushes of
// main into silent no-ops).
//
// Usage:  node scripts/swarm/orchestrator.mjs [--max N] [--dry-run] [--no-release] [--rounds N] [--requeue ANA-xxx]
// Safety: claims only Linear issues labeled `swarm` in Todo (team Analitics-platform/ANA);
//         single-instance lock in .task-board/; failures comment on the issue.

import { spawn } from 'node:child_process';
import {
  openSync,
  writeSync,
  closeSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  appendFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const SWARM = resolve(ROOT, 'scripts/swarm');
const STATE = resolve(ROOT, '.task-board');
const LOGS = resolve(STATE, 'log');
const WT = resolve(ROOT, '.swarm-worktree'); // the ONLY place the swarm touches
const LABEL = 'swarm';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const num = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) || def : def;
};
const MAX_TASKS = num('--max', 1);
const MAX_ROUNDS = num('--rounds', 3);
const DRY = flag('--dry-run');
const NO_RELEASE = flag('--no-release');
const REQUEUE = (() => {
  const i = args.indexOf('--requeue');
  return i >= 0 ? args[i + 1] : null;
})();

const ROLES = {
  executor: readFileSync(resolve(SWARM, 'roles/executor.md'), 'utf8'),
  reviewer: readFileSync(resolve(SWARM, 'roles/reviewer.md'), 'utf8'),
  documenter: readFileSync(resolve(SWARM, 'roles/documenter.md'), 'utf8'),
  clerk: readFileSync(resolve(SWARM, 'roles/clerk.md'), 'utf8'),
};

let logFile = null;
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
function log(msg) {
  const line = `[${ts()}] ${msg}`;
  console.log(line);
  if (logFile) appendFileSync(logFile, line + '\n');
}
const short = (s, n = 400) => String(s).replace(/\s+/g, ' ').trim().slice(0, n);

function run(cmd, args_, { timeoutMs = 600_000, cwd = ROOT } = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args_, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '',
      err = '';
    const finish = (code) => {
      clearTimeout(t);
      clearTimeout(t2);
      res({ code, out, err, all: out + err });
    };
    const t = setTimeout(() => {
      try {
        p.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }, timeoutMs);
    // A SIGKILLed CLI may leave grandchildren holding stdio pipes — 'close' then hangs.
    // Hard-cap the step: resolve 60s after the kill with whatever was captured.
    const t2 = setTimeout(() => finish(null), timeoutMs + 60_000);
    p.stdout.on('data', (d) => {
      out += d;
    });
    p.stderr.on('data', (d) => {
      err += d;
    });
    p.on('close', (code) => finish(code));
  });
}
const sh = async (cmd, opts) => {
  // NOT a login shell (-l): .bash_profile reorders PATH to a system node with a different
  // V8 ABI than the nvm node that compiled better-sqlite3 — every DB test then fails in
  // mass (runs 1-8: 326 instant failures). `-c` inherits the operator's environment.
  const r = await run('bash', ['-c', cmd], opts);
  log(`  $ ${cmd.slice(0, 140)} → ${r.code}`);
  return r;
};

async function worker(role, vars, { timeoutMs = 40 * 60_000, cwd = ROOT } = {}) {
  let prompt = ROLES[role];
  for (const [k, v] of Object.entries(vars)) prompt = prompt.replaceAll(`{{${k}}}`, v ?? '');
  log(`  [${role}] worker started (timeout ${Math.round(timeoutMs / 60000)}m)`);
  const r = await run('opencode', ['run', '--auto', prompt], { timeoutMs, cwd });
  const tail = r.all.slice(-4000);
  log(`  [${role}] finished code=${r.code}`);
  log(`  [${role}] tail: ${short(tail, 600)}`);
  return { ...r, tail };
}
const after = (text, marker, until) => {
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const j = until ? text.indexOf(until, i + marker.length) : -1;
  return text.slice(i + marker.length, j > 0 ? j : undefined).trim();
};

async function clerk(op) {
  const r = await worker('clerk', { OP: op }, { timeoutMs: 6 * 60_000 });
  if (!r.tail.includes('CLERK_OK')) throw new Error(`clerk failed: ${short(r.tail)}`);
  return r.tail;
}

// ---------- pipeline steps ----------

export function parsePickOutput(out) {
  if (/\bSWARM_PICK::NONE\b/.test(out)) return null;
  const m = out.match(/SWARM_PICK::([^:\n]+)::([^:\n]+)::([\s\S]*?)(?:\n|$)/);
  if (!m) throw new Error('cannot parse clerk pick output');
  const issue = { id: m[1].trim(), identifier: m[2].trim(), title: m[3].trim() };
  // Guard against the clerk echoing the format template with literal placeholders
  // (career-ops-ui run 1: it printed SWARM_PICK::<issueId>::<identifier>::<title> verbatim).
  if (/[<>]/.test(issue.id + issue.identifier + issue.title)) {
    throw new Error('clerk output contains placeholder characters — refusing');
  }
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(issue.identifier)) {
    throw new Error(
      `clerk returned a non-issue identifier ("${short(issue.identifier, 40)}") — refusing to continue`,
    );
  }
  return issue;
}

async function pickIssue() {
  const out = await clerk(
    `Read-only. In the Linear WORKSPACE "analitics-platform" (verify with get_workspace; use the linear MCP server connected to it — typically named "linear-analitics"; NEVER touch other workspaces or teams), team "Analitics-platform" (key ANA): list issues that have the label "${LABEL}" and are in state "Todo" (use list_issues with a filter; if label filtering is unsupported, list Todo issues and check their labels). Take the FIRST one. Do NOT modify anything.\nPrint the result as a data line, substituting REAL values from the issue — never print placeholder words like <issueId> or <identifier>:\nSWARM_PICK::<REAL issueId>::<REAL identifier like ANA-123>::<REAL title>\nIf there is no such issue, print exactly: SWARM_PICK::NONE`,
  );
  return parsePickOutput(out);
}
const claimIssue = (i) =>
  clerk(
    `Operation: in workspace "analitics-platform", team ANA, for issue ${i.identifier} (id ${i.id}) set state to "In Progress" and add comment: "🎯 Swarm claimed this issue — orchestrator starting (dev → gates → review → release)."\nResult line: SWARM_CLAIM::<identifier>`,
  );
const doneIssue = (i, evidence) =>
  clerk(
    `Operation: in workspace "analitics-platform", for issue ${i.identifier} set state "Done" and add comment:\n---\n${evidence}\n---\nResult line: SWARM_DONE::<identifier>`,
  );
const cancelIssue = (i, why) =>
  clerk(
    `Operation: in workspace "analitics-platform", for issue ${i.identifier} set state "Canceled" and add comment: "Swarm: ${why} — nothing to ship."\nResult line: SWARM_CANCEL::<identifier>`,
  );
const failIssue = async (i, step, msg) => {
  try {
    await clerk(
      `Operation: in workspace "analitics-platform", add comment to issue ${i.identifier}: "⚠️ Swarm failed at step ${step}: ${short(msg, 300)}"\nResult line: SWARM_FAIL::<identifier>`,
    );
  } catch (e) {
    log(`  (clerk failure-report also failed: ${short(String(e))})`);
  }
};

const extractDev = (tail) => {
  const status =
    (tail.match(/status:\s*(done|already-implemented|not-reproducible|blocked)/) || [])[1] ||
    'blocked';
  return { status, summary: after(tail, 'DEV_SUMMARY:') || '' };
};
const extractVerdict = (tail) => {
  if (/VERDICT:\s*ACCEPT/.test(tail)) return { verdict: 'ACCEPT', notes: '' };
  if (/VERDICT:\s*RETURN/.test(tail))
    return {
      verdict: 'RETURN',
      notes: after(tail, 'VERDICT: RETURN', /\ntitle:|<\/DIFF>/) || short(tail, 600),
    };
  return { verdict: 'RETURN', notes: 'reviewer produced no verdict — treat as RETURN' };
};

// Recreate the swarm worktree at origin/main. Fresh per cycle: cheap (~1s), and by
// construction free of data/, .env and any stale build state.
async function refreshWorktree() {
  await sh(`rm -rf ${JSON.stringify(WT)} && git worktree prune`);
  const r = await sh(`git worktree add --detach ${JSON.stringify(WT)} origin/main`, {
    timeoutMs: 120_000,
  });
  if (r.code !== 0) throw new Error(`cannot create swarm worktree: ${short(r.all)}`);
  const g = await sh(`git -C ${JSON.stringify(WT)} status --porcelain`);
  if (g.out.trim()) throw new Error(`swarm worktree is not clean — aborting: ${short(g.out, 200)}`);
  // Symlinks AFTER the clean check: git's `node_modules/` rule does not match a symlink
  // (not a directory), so the links would show as untracked and trip the check above.
  await sh(
    `ln -sfn ${JSON.stringify(ROOT + '/node_modules')} ${JSON.stringify(WT + '/node_modules')} && for p in backend frontend shared; do mkdir -p ${JSON.stringify(WT + '/code')} && ln -sfn ${JSON.stringify(ROOT + '/code/' + '$p/node_modules')} ${JSON.stringify(WT + '/code/$p/node_modules')}; done`,
  );
}

// Release version bump without npm: patch the root package.json (single source of truth;
// workspace packages are 0.0.0 and ignored), then propagate version markers into docs.
async function bumpVersion(base) {
  const pkgPath = resolve(base, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const [maj, min, pat] = String(pkg.version)
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  const ver = `${maj}.${min}.${pat + 1}`;
  pkg.version = ver;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  const sync = await sh(`cd ${JSON.stringify(base)} && pnpm sync-versions`, { timeoutMs: 120_000 });
  if (sync.code !== 0) throw new Error(`sync-versions failed: ${short(sync.all)}`);
  return ver;
}

// Insert the release entry after the `## [Unreleased]` block (Keep-a-Changelog, RU).
function prependChangelog(base, ver, fixed, notes) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = `\n## [${ver}] - ${today}\n\n### Fixed\n\n${fixed}\n\n### Notes\n\n${notes}\n`;
  const path = resolve(base, 'CHANGELOG.md');
  const text = readFileSync(path, 'utf8');
  const marker = '## [Unreleased]';
  const i = text.indexOf(marker);
  if (i < 0) {
    writeFileSync(path, entry + text);
    return;
  }
  // Skip the Unreleased heading plus any bullets/blank lines belonging to it (empty in practice).
  let j = text.indexOf('\n## [', i + marker.length);
  if (j < 0) j = text.length;
  else j += 1;
  writeFileSync(path, text.slice(0, j) + entry + text.slice(j));
}

async function main() {
  if (!existsSync(resolve(ROOT, 'package.json')))
    throw new Error('run from the repo root (yandex-metrika-analyse-dashboard)');
  mkdirSync(LOGS, { recursive: true });
  const lock = resolve(STATE, 'lock');
  try {
    const fd = openSync(lock, 'wx'); // exclusive create — no exists/write race
    writeSync(fd, String(process.pid));
    closeSync(fd);
  } catch {
    throw new Error('another swarm instance holds the lock (.task-board/lock)');
  }

  try {
    // Admin op via the clerk: return a stuck issue (e.g. after a crashed run) to the queue.
    if (REQUEUE) {
      log(`--requeue ${REQUEUE}`);
      const out = await clerk(
        `Operation: in workspace "analitics-platform", find issue ${REQUEUE} in team ANA, set its state to "Todo" and add comment: "♻️ Swarm requeue — returned to the queue by the operator."\nResult line: SWARM_REQUEUE::${REQUEUE}`,
      );
      log(
        out.includes(`SWARM_REQUEUE::${REQUEUE}`)
          ? `requeued: ${REQUEUE} → Todo`
          : `requeue result unclear: ${short(out, 200)}`,
      );
      return;
    }
    for (let n = 0; n < MAX_TASKS; n++) {
      logFile = resolve(LOGS, `cycle-${Date.now()}.log`);
      log(`=== task ${n + 1}/${MAX_TASKS} ===`);

      await sh('git fetch origin -q', { timeoutMs: 120_000 });
      await refreshWorktree();

      const issue = await pickIssue();
      if (!issue) {
        log('queue empty — no Todo issues labeled `swarm` in ANA.');
        break;
      }
      log(`picked ${issue.identifier}: ${issue.title}`);
      if (DRY) {
        log('dry-run: would claim → develop → gates → review → document → release → Done.');
        break;
      }

      const branch = `swarm/${issue.identifier.toLowerCase()}`;
      let accepted = null,
        devStatus = null,
        devSummary = '',
        story = null,
        mergedDone = false;

      try {
        await claimIssue(issue);
      } catch (e) {
        throw new Error(`claim: ${short(String(e))}`);
      }

      try {
        // ---- develop (executor ↔ reviewer loop, deterministic TESTER between rounds)
        let reviewNotes = '';
        let round = 0;
        for (; round < MAX_ROUNDS; round++) {
          log(`-- round ${round + 1}/${MAX_ROUNDS}: develop`);
          await sh(`git -C ${JSON.stringify(WT)} checkout -q -B ${branch} origin/main`);
          const dev = await worker(
            'executor',
            {
              IDENTIFIER: issue.identifier,
              TITLE: issue.title,
              ROUND: String(round + 1),
              DESCRIPTION:
                '(fetch the full issue BODY via the Linear MCP if needed; never read or judge the issue STATE — the orchestrator owns the lifecycle)',
              REVIEW_NOTES: reviewNotes
                ? `\nREVIEWER RETURNED THIS CHANGE WITH NOTES — address every point:\n${reviewNotes}`
                : '',
            },
            { cwd: WT },
          );
          const commits = parseInt(
            (
              await sh(`git -C ${JSON.stringify(WT)} rev-list --count origin/main..HEAD`)
            ).out.trim() || '0',
            10,
          );
          const dev1 = extractDev(dev.tail);
          // The tree is the truth: a committed branch goes to the gates even if the
          // executor's summary line claims otherwise (gates + review are the arbiters).
          devStatus = commits > 0 ? 'done' : dev1.status === 'done' ? 'blocked' : dev1.status;
          devSummary = dev1.summary;
          log(
            `  commits on branch: ${commits}; executor status: ${dev1.status} → using ${devStatus}`,
          );
          // Lesson from career-ops-ui: an executor that reports "already-implemented" may
          // have FOUND its own lost work — the branch was recreated with -B and the commit
          // survived only in the reflog. Rescue it instead of canceling.
          if (devStatus !== 'done' && dev1.status !== 'not-reproducible') {
            const found = await sh(
              `git -C ${JSON.stringify(WT)} log --all --grep="${issue.identifier}" --pretty=%H -5`,
              { timeoutMs: 60_000 },
            );
            let sha = '',
              mergedSha = '';
            for (const cand of found.out.trim().split('\n')) {
              if (!/^[0-9a-f]{7,40}$/.test(cand)) continue;
              const anc = await sh(
                `git -C ${JSON.stringify(WT)} merge-base --is-ancestor ${cand} origin/main && echo ancestor || echo fresh`,
              );
              if (anc.out.includes('fresh')) {
                sha = cand;
                break;
              } // newest non-merged match
              if (!mergedSha) mergedSha = cand; // newest already-merged match
            }
            if (!sha && mergedSha) {
              const ev = `**Already merged to main** — the executor's work is commit ${mergedSha.slice(0, 9)} (an ancestor of origin/main; CI green on the containing run). Nothing left to ship.`;
              await doneIssue(issue, ev);
              log(`already merged: ${mergedSha.slice(0, 9)} — issue closed as Done`);
              mergedDone = true;
              break;
            }
            if (sha) {
              log(
                `  reflog rescue: found lost work ${sha.slice(0, 9)} for ${issue.identifier} — cherry-picking`,
              );
              // Probe emptiness first: if the patch is already contained in origin/main
              // (e.g. an executor pushed it directly — run 8), the cherry-pick would come
              // up empty and the old code misread that as "blocked", killing the run.
              const probe = await sh(`git -C ${JSON.stringify(WT)} cherry-pick --no-commit ${sha}`);
              let emptyPatch = false;
              if (probe.code === 0) {
                const isem = await sh(`git -C ${JSON.stringify(WT)} diff --cached --quiet`);
                if (isem.code === 0) {
                  emptyPatch = true;
                  await sh(`git -C ${JSON.stringify(WT)} reset -q --hard HEAD`);
                } else {
                  await sh(`git -C ${JSON.stringify(WT)} reset -q --hard HEAD`);
                }
              } else {
                await sh(`git -C ${JSON.stringify(WT)} cherry-pick --abort`);
              }
              if (emptyPatch) {
                const ev = `**Already merged to main** — the rescued commit ${sha.slice(0, 9)} is content-identical to what origin/main already ships. Nothing left to ship.`;
                await doneIssue(issue, ev);
                log(`  rescued patch is empty — work already in origin/main: issue closed as Done`);
                mergedDone = true;
                break;
              }
              const cp = await sh(`git -C ${JSON.stringify(WT)} cherry-pick ${sha}`);
              const after2 = parseInt(
                (
                  await sh(`git -C ${JSON.stringify(WT)} rev-list --count origin/main..HEAD`)
                ).out.trim() || '0',
                10,
              );
              if (cp.code === 0 && after2 > 0) {
                devStatus = 'done';
                devSummary = `(rescued from lost branch commit ${sha.slice(0, 9)}) ${devSummary}`;
                log(`  rescued: ${after2} commit(s) on the branch — proceeding to gates`);
              } else {
                await sh(`git -C ${JSON.stringify(WT)} cherry-pick --abort`);
              }
            }
          }
          if (devStatus !== 'done') break;

          log('-- tester: deterministic gates (pnpm test:ci) in the clean swarm worktree');
          const gates = await sh(
            `cd ${JSON.stringify(WT)} && pnpm test:ci 2>&1 | tee ${JSON.stringify(STATE + '/gates-last.log')}; exit \${PIPESTATUS[0]}`,
            { timeoutMs: 40 * 60_000 },
          );
          if (gates.code !== 0) {
            if (round + 1 < MAX_ROUNDS) {
              reviewNotes = `The test gate failed (lint/format/typecheck/coverage/build). Full log: .task-board/gates-last.log. Output tail:\n${short(gates.all.slice(-1500), 1500)}`;
              log(
                `  gates FAILED — feeding output back to the executor; tail: ${short(gates.all.slice(-500), 350)}`,
              );
              continue;
            }
            throw new Error(
              `gates failed after ${MAX_ROUNDS} rounds; full log: .task-board/gates-last.log; last tail: ${short(gates.all.slice(-600), 500)}`,
            );
          }
          log(`  gates green`);

          log(`-- round ${round + 1}: review`);
          const diff = await sh(`git -C ${JSON.stringify(WT)} diff origin/main...HEAD`);
          const rev = await worker(
            'reviewer',
            {
              IDENTIFIER: issue.identifier,
              TITLE: issue.title,
              DESCRIPTION: '(the executor fetched the issue body; judge the diff below)',
              DIFF: `<DIFF>\n${diff.all.slice(0, 60_000)}\n</DIFF>`,
            },
            { timeoutMs: 12 * 60_000 },
          );
          const v = extractVerdict(rev.tail);
          if (v.verdict === 'ACCEPT') {
            accepted = true;
            log('  verdict: ACCEPT');
            break;
          }
          accepted = false;
          reviewNotes = v.notes;
          log(`  verdict: RETURN — ${short(v.notes, 160)}`);
        }
        if (mergedDone) {
          log('finished: work already merged — issue closed as Done');
          continue;
        }
        if (devStatus !== 'done') {
          if (devStatus === 'blocked') {
            await failIssue(
              issue,
              'executor',
              'reported blocked — the branch and the board are left for human review',
            );
            throw new Error('executor reported blocked');
          }
          await cancelIssue(issue, `executor reported "${devStatus}"`);
          log(`finished: ${devStatus} — issue canceled`);
          continue;
        }
        if (!accepted) {
          await failIssue(
            issue,
            'review',
            `no ACCEPT in ${MAX_ROUNDS} rounds; branch ${branch} kept for human review`,
          );
          throw new Error(`review: no ACCEPT in ${MAX_ROUNDS} rounds`);
        }

        // ---- document
        log('-- documenter');
        const stat = await sh(`git -C ${JSON.stringify(WT)} diff --stat origin/main...HEAD`);
        const doc = await worker(
          'documenter',
          {
            IDENTIFIER: issue.identifier,
            TITLE: issue.title,
            DEV_SUMMARY: devSummary || '(no summary)',
            DIFF_STAT: short(stat.out, 1200),
          },
          { timeoutMs: 8 * 60_000 },
        );
        const fixed = after(doc.tail, 'CHLOG_FIXED:', 'CHLOG_NOTES:');
        const notes = after(doc.tail, 'CHLOG_NOTES:', 'STORY:');
        story = after(doc.tail, 'STORY:');
        if (!fixed || !notes || !story) throw new Error('documenter output incomplete');
        log(`  story: ${short(story, 120)}`);

        if (NO_RELEASE) {
          log('--no-release: stopping after ACCEPT + document.');
          break;
        }

        // ---- release manager: PR → checks → squash → version+changelog on main → CI/E2E → tag → Release
        log('-- release manager: PR');
        const prTitle = `fix: ${issue.identifier} — ${issue.title.replace(/"/g, "'")}`.slice(
          0,
          120,
        );
        const pr = await sh(
          `cd ${JSON.stringify(WT)} && gh pr create --head ${branch} --title "${prTitle}" --body "${story.replace(/"/g, "'").slice(0, 400)}\\n\\nSwarm cycle: dev(${MAX_ROUNDS} rounds max) → gates → review(ACCEPT) → release. Closes ${issue.identifier}."`,
          { timeoutMs: 120_000 },
        );
        const prUrl = (pr.out.match(/https:\/\/github\.com\/\S+/) || [])[0];
        if (!prUrl) throw new Error(`gh pr create failed: ${short(pr.all)}`);
        await sh(`gh pr checks --watch ${prUrl.split('/').pop()} --require-passing`, {
          timeoutMs: 45 * 60_000,
        });
        await sh(`gh pr merge ${prUrl.split('/').pop()} --squash --delete-branch`, {
          timeoutMs: 300_000,
        });
        log(`  merged: ${prUrl}`);

        // Version + CHANGELOG on a temp branch straight off origin/main, pushed to main
        // (the user's checkout holds `main` — worktrees may not check it out locally).
        log('-- release manager: version bump + CHANGELOG (temp branch → origin/main)');
        await sh(`git -C ${JSON.stringify(WT)} checkout -q -B swarm-release origin/main`);
        const ver = await bumpVersion(WT);
        log(`-- release manager: v${ver} (CHANGELOG + sync-versions)`);
        prependChangelog(WT, ver, fixed, notes);
        const relCommit = await sh(
          `git -C ${JSON.stringify(WT)} add -A && git -C ${JSON.stringify(WT)} commit -q -m "release: v${ver} (swarm ${issue.identifier})" && git -C ${JSON.stringify(WT)} push -q origin HEAD:main`,
          { timeoutMs: 300_000 },
        );
        if (relCommit.code !== 0) throw new Error(`release commit failed: ${short(relCommit.all)}`);

        log('-- release manager: watch CI + E2E on main');
        await sh('sleep 20');
        const ciId = (
          await sh(
            `gh run list --workflow=ci.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId'`,
          )
        ).out.trim();
        await sh(`gh run watch ${ciId} --exit-status`, { timeoutMs: 60 * 60_000 });
        await sh('sleep 10');
        const e2eId = (
          await sh(
            `gh run list --workflow=e2e.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId'`,
          )
        ).out.trim();
        await sh(`gh run watch ${e2eId} --exit-status`, { timeoutMs: 45 * 60_000 });

        log('-- release manager: tag → Release (publish)');
        await sh(
          `git -C ${JSON.stringify(WT)} tag -f v${ver} origin/main && git -C ${JSON.stringify(WT)} push -q -f origin v${ver}`,
        );
        await sh('sleep 15');
        const relId = (
          await sh(
            `gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId'`,
          )
        ).out.trim();
        await sh(`gh run watch ${relId} --exit-status`, { timeoutMs: 40 * 60_000 });

        const today = new Date().toISOString().slice(0, 10);
        const evidence = `**Shipped by the agent swarm in v${ver}** (${today})\n\n- Issue: ${issue.identifier} — ${issue.title}\n- PR: ${prUrl} (squash-merged, PR checks ✓)\n- Release chain: main CI ✓ + E2E ✓ → tag v${ver} → release.yml verify+publish ✓\n- Story: ${short(story, 300)}`;
        await doneIssue(issue, evidence);
        await sh(`git -C ${JSON.stringify(WT)} branch -D ${branch}`);
        log(`=== DONE: ${issue.identifier} shipped as v${ver} ===`);
      } catch (e) {
        await failIssue(issue, 'pipeline', String(e));
        throw e;
      }
    }
  } finally {
    try {
      unlinkSync(resolve(STATE, 'lock'));
    } catch {
      /* lock already gone */
    }
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === decodeURIComponent(new URL(import.meta.url).pathname);
if (isMain) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(`SWARM ERROR: ${String(e).slice(0, 500)}`);
      process.exit(1);
    },
  );
}
