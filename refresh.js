#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { execFileSync, execSync } = require('child_process')

const HOME = process.env.HOME
const CACHE_DIR = path.join(HOME, '.ccusage-widget')
const OUT = path.join(CACHE_DIR, 'data.json')
const TMP = OUT + '.tmp'
const NODE_BIN = process.env.CCUSAGE_NODE || process.execPath
const CCUSAGE = process.env.CCUSAGE_PATH || (() => {
  const candidates = [
    path.join(HOME, '.npm-global/lib/node_modules/ccusage/dist/index.js'),
    '/usr/local/lib/node_modules/ccusage/dist/index.js',
    '/opt/homebrew/lib/node_modules/ccusage/dist/index.js'
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim()
    const p = path.join(root, 'ccusage', 'dist', 'index.js')
    if (fs.existsSync(p)) return p
  } catch {}
  throw new Error('ccusage not found — install with: npm install -g ccusage')
})()
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects')
const LB_CONFIG = path.join(CACHE_DIR, 'leaderboard.config.json')
const LB_REPO_DIR = path.join(CACHE_DIR, 'leaderboard-repo')

const since = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
})()

let daily
try {
  const raw = execFileSync(NODE_BIN, [CCUSAGE, 'daily', '-j', '-O', '--since', since], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  daily = JSON.parse(raw)
} catch (e) {
  console.error('ccusage failed:', e.message)
  process.exit(1)
}

const walk = (dir) => {
  let out = []
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out = out.concat(walk(p))
    else if (e.isFile() && p.endsWith('.jsonl')) out.push(p)
  }
  return out
}

const matrix = Array.from({ length: 7 }, () => Array(24).fill(0))
const todayKey = new Date().toISOString().slice(0, 10)
const todayHourly = Array(24).fill(0)
const dailyMsgs = new Map()
let total = 0
const seen = new Set()

// pricing per-model (USD per 1M tokens) — approximate, matches Anthropic public rates
const PRICING = {
  'claude-opus-4-7':   { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-opus-4-6':   { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-opus-4-5':   { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-opus-4':     { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-6': { input:  3, output: 15, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-sonnet-4-5': { input:  3, output: 15, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-sonnet-4':   { input:  3, output: 15, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-haiku-4-5':  { input:  1, output:  5, cacheWrite:  1.25, cacheRead: 0.10 },
  'claude-haiku-4':    { input:  1, output:  5, cacheWrite:  1.25, cacheRead: 0.10 }
}
const priceFor = (model) => {
  if (!model) return PRICING['claude-sonnet-4-6']
  if (PRICING[model]) return PRICING[model]
  const key = Object.keys(PRICING).find(k => model.includes(k.replace('claude-', '').replace(/-\d+$/, '')))
  if (key) return PRICING[key]
  if (model.includes('opus')) return PRICING['claude-opus-4-6']
  if (model.includes('haiku')) return PRICING['claude-haiku-4-5']
  return PRICING['claude-sonnet-4-6']
}

// projects: keyed by cwd (full path); stores tokens/cost/time buckets
const projects = new Map()
const projKey = (cwd) => cwd || 'unknown'
const projName = (cwd) => {
  if (!cwd) return 'unknown'
  const parts = cwd.split('/').filter(Boolean)
  return parts[parts.length - 1] || cwd
}
const ensureProj = (cwd) => {
  const k = projKey(cwd)
  let p = projects.get(k)
  if (!p) {
    p = {
      key: k,
      name: projName(cwd),
      cwd: cwd || null,
      inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
      totalTokens: 0, totalCost: 0,
      daily: new Map(),          // date -> { tokens, cost }
      activeMinutes: new Set(),  // YYYY-MM-DDTHH:MM — all-time
      lastTs: null, firstTs: null
    }
    projects.set(k, p)
  }
  return p
}

const files = walk(PROJECTS_DIR)
for (const f of files) {
  let content
  try { content = fs.readFileSync(f, 'utf8') } catch { continue }
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    const ts = obj.timestamp
    if (!ts) continue
    const d = new Date(ts)
    if (isNaN(d.getTime())) continue

    // user-message hotspot + dailyMsgs (unchanged behavior)
    if (obj.type === 'user') {
      const uuid = obj.uuid
      if (!uuid || !seen.has(uuid)) {
        if (uuid) seen.add(uuid)
        matrix[d.getDay()][d.getHours()] += 1
        const dateKey = d.toISOString().slice(0, 10)
        dailyMsgs.set(dateKey, (dailyMsgs.get(dateKey) || 0) + 1)
        if (dateKey === todayKey) todayHourly[d.getHours()] += 1
        total += 1
      }
    }

    // per-project aggregation — attribute on assistant messages (where tokens live)
    // but also count active-minutes on any message (user or assistant)
    const cwd = obj.cwd || (f.includes('/projects/') ? null : null)
    const p = ensureProj(cwd)
    const minuteKey = d.toISOString().slice(0, 16) // YYYY-MM-DDTHH:MM
    p.activeMinutes.add(minuteKey)
    if (!p.firstTs || ts < p.firstTs) p.firstTs = ts
    if (!p.lastTs || ts > p.lastTs) p.lastTs = ts

    if (obj.type === 'assistant' && obj.message && obj.message.usage) {
      const u = obj.message.usage
      const model = obj.message.model || ''
      const inT = u.input_tokens || 0
      const outT = u.output_tokens || 0
      const ccT = u.cache_creation_input_tokens || 0
      const crT = u.cache_read_input_tokens || 0
      const price = priceFor(model)
      const cost = (inT * price.input + outT * price.output +
                    ccT * price.cacheWrite + crT * price.cacheRead) / 1e6
      const tokens = inT + outT + ccT + crT
      p.inputTokens += inT
      p.outputTokens += outT
      p.cacheCreationTokens += ccT
      p.cacheReadTokens += crT
      p.totalTokens += tokens
      p.totalCost += cost

      const dateKey = d.toISOString().slice(0, 10)
      const dayBucket = p.daily.get(dateKey) || { tokens: 0, cost: 0, mins: new Set() }
      dayBucket.tokens += tokens
      dayBucket.cost += cost
      p.daily.set(dateKey, dayBucket)
    }

    // track active-minutes per-day so we can window them
    const dateKey2 = d.toISOString().slice(0, 10)
    const db = p.daily.get(dateKey2) || { tokens: 0, cost: 0, mins: new Set() }
    db.mins.add(minuteKey)
    p.daily.set(dateKey2, db)
  }
}

const dayTotals = matrix.map(row => row.reduce((s, x) => s + x, 0))
const hourTotals = Array.from({ length: 24 }, (_, h) =>
  matrix.reduce((s, row) => s + row[h], 0)
)
const topDay = dayTotals.indexOf(Math.max(...dayTotals))
const topHour = hourTotals.indexOf(Math.max(...hourTotals))
let peak = 0
for (const row of matrix) for (const v of row) if (v > peak) peak = v

daily.hotspot = {
  matrix, total, peak, topDay, topHour, dayTotals, hourTotals,
  generatedAt: new Date().toISOString()
}

daily.todayHotspot = {
  hourly: todayHourly,
  total: todayHourly.reduce((s, v) => s + v, 0),
  peak: Math.max(...todayHourly, 1),
  generatedAt: new Date().toISOString()
}

// merge prompt counts into daily entries
for (const d of (daily.daily || [])) {
  if (d && d.date) d.prompts = dailyMsgs.get(d.date) || 0
}

const dailyTokens = new Map()
let totalTokens = 0
for (const d of (daily.daily || [])) {
  if (!d || !d.date) continue
  const t = d.totalTokens || 0
  dailyTokens.set(d.date, t)
  totalTokens += t
}

function computeMyStats() {
  const today = new Date()
  const keyFor = (offset) => {
    const d = new Date(today)
    d.setDate(d.getDate() - offset)
    return d.toISOString().slice(0, 10)
  }
  let last7dMsgs = 0, last30dMsgs = 0
  let last7dTokens = 0, last30dTokens = 0
  for (let i = 0; i < 7; i++) {
    last7dMsgs += dailyMsgs.get(keyFor(i)) || 0
    last7dTokens += dailyTokens.get(keyFor(i)) || 0
  }
  for (let i = 0; i < 30; i++) {
    last30dMsgs += dailyMsgs.get(keyFor(i)) || 0
    last30dTokens += dailyTokens.get(keyFor(i)) || 0
  }
  let streak = 0
  for (let i = 0; i < 365; i++) {
    if ((dailyMsgs.get(keyFor(i)) || 0) > 0) streak++
    else break
  }
  return {
    last7dMsgs,
    last30dMsgs,
    totalMsgs: total,
    last7dTokens,
    last30dTokens,
    totalTokens,
    streak,
    peakDay: topDay,
    peakHour: topHour,
    updatedAt: new Date().toISOString()
  }
}

function syncLeaderboard() {
  if (!fs.existsSync(LB_CONFIG)) return null
  let cfg
  try { cfg = JSON.parse(fs.readFileSync(LB_CONFIG, 'utf8')) } catch { return null }
  const { handle, repo } = cfg
  if (!handle || !repo) return null

  const opts = { stdio: 'pipe', encoding: 'utf8' }
  const gitEnv = Object.assign({}, process.env, {
    GIT_AUTHOR_NAME: handle,
    GIT_AUTHOR_EMAIL: `${handle}@ccusage-widget.local`,
    GIT_COMMITTER_NAME: handle,
    GIT_COMMITTER_EMAIL: `${handle}@ccusage-widget.local`
  })

  try {
    if (!fs.existsSync(LB_REPO_DIR)) {
      execSync(`gh repo clone ${repo} "${LB_REPO_DIR}"`, opts)
    } else {
      try {
        execSync('git fetch origin', { cwd: LB_REPO_DIR, ...opts })
        execSync('git reset --hard origin/HEAD', { cwd: LB_REPO_DIR, ...opts })
      } catch {
        execSync('git pull --ff-only', { cwd: LB_REPO_DIR, ...opts })
      }
    }

    const statsDir = path.join(LB_REPO_DIR, 'stats')
    fs.mkdirSync(statsDir, { recursive: true })

    const myStats = computeMyStats()
    const payload = Object.assign({ handle }, myStats)
    const redact = Array.isArray(cfg.redact) ? cfg.redact : []
    for (const key of redact) {
      if (key !== 'handle') delete payload[key]
    }
    const myFile = path.join(statsDir, `${handle}.json`)
    fs.writeFileSync(myFile, JSON.stringify(payload, null, 2) + '\n')

    const status = execSync('git status --porcelain', { cwd: LB_REPO_DIR, encoding: 'utf8' })
    if (status.trim()) {
      execSync(`git add "stats/${handle}.json"`, { cwd: LB_REPO_DIR, ...opts })
      execSync(`git commit -m "update ${handle} stats"`, { cwd: LB_REPO_DIR, env: gitEnv, ...opts })
      // retry push — collisions happen when multiple participants push at once.
      // each user only touches their own stats/{handle}.json, so rebase is conflict-free.
      let pushed = false
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          execSync('git push', { cwd: LB_REPO_DIR, ...opts })
          pushed = true
          break
        } catch (e) {
          const msg = (e.message || '') + (e.stderr ? e.stderr.toString() : '')
          if (!/non-fast-forward|cannot lock ref|rejected|fetch first|stale info/i.test(msg)) throw e
          const waitMs = 400 + Math.floor(Math.random() * 800)
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs)
          try {
            execSync('git fetch origin', { cwd: LB_REPO_DIR, ...opts })
            execSync('git rebase origin/HEAD', { cwd: LB_REPO_DIR, env: gitEnv, ...opts })
          } catch (rebaseErr) {
            execSync('git rebase --abort', { cwd: LB_REPO_DIR, stdio: 'ignore' })
            throw rebaseErr
          }
        }
      }
      if (!pushed) throw new Error('git push failed after retries')
    }

    const entries = fs.readdirSync(statsDir).filter(f => f.endsWith('.json'))
    const participants = []
    for (const f of entries) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(statsDir, f), 'utf8'))
        if (p && p.handle) participants.push(p)
      } catch {}
    }
    return { myHandle: handle, participants, syncedAt: new Date().toISOString() }
  } catch (e) {
    console.error('leaderboard sync failed:', e.message)
    return { myHandle: handle, participants: [], error: e.message, syncedAt: new Date().toISOString() }
  }
}

const lb = syncLeaderboard()
if (lb) daily.leaderboard = lb

// build per-window project stats (rolling N full days back from today)
const DAY = 86400000
const cutoffKey = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10)
const windowAggregate = (p, days) => {
  const cutoff = cutoffKey(days)
  let tokens = 0, cost = 0
  const mins = new Set()
  for (const [dateKey, bucket] of p.daily) {
    if (dateKey < cutoff) continue
    tokens += bucket.tokens
    cost += bucket.cost
    for (const m of bucket.mins) mins.add(m)
  }
  return { tokens, cost, activeMinutes: mins.size }
}

const projectsArr = Array.from(projects.values()).map(p => {
  const last7  = windowAggregate(p, 7)
  const last30 = windowAggregate(p, 30)
  return {
    key: p.key,
    name: p.name,
    cwd: p.cwd,
    totalTokens: p.totalTokens,
    totalCost: Math.round(p.totalCost * 10000) / 10000,
    inputTokens: p.inputTokens,
    outputTokens: p.outputTokens,
    cacheCreationTokens: p.cacheCreationTokens,
    cacheReadTokens: p.cacheReadTokens,
    activeMinutes: p.activeMinutes.size,
    last7dTokens: last7.tokens,
    last7dCost: Math.round(last7.cost * 10000) / 10000,
    last7dActiveMinutes: last7.activeMinutes,
    last30dTokens: last30.tokens,
    last30dCost: Math.round(last30.cost * 10000) / 10000,
    last30dActiveMinutes: last30.activeMinutes,
    firstTs: p.firstTs,
    lastTs: p.lastTs
  }
}).filter(p => p.totalTokens > 0 || p.activeMinutes > 0)

projectsArr.sort((a, b) => (b.last30dCost || 0) - (a.last30dCost || 0))
daily.projects = projectsArr

fs.mkdirSync(CACHE_DIR, { recursive: true })
fs.writeFileSync(TMP, JSON.stringify(daily))
fs.renameSync(TMP, OUT)
