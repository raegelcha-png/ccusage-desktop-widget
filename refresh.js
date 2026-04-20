#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { execFileSync, execSync } = require('child_process')

const HOME = process.env.HOME
const CACHE_DIR = path.join(HOME, '.ccusage-widget')
const OUT = path.join(CACHE_DIR, 'data.json')
const TMP = OUT + '.tmp'
const NODE_BIN = '/usr/local/bin/node'
const CCUSAGE = path.join(HOME, '.npm-global/lib/node_modules/ccusage/dist/index.js')
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
const dailyMsgs = new Map()
let total = 0
const seen = new Set()

const files = walk(PROJECTS_DIR)
for (const f of files) {
  let content
  try { content = fs.readFileSync(f, 'utf8') } catch { continue }
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    if (obj.type !== 'user') continue
    const ts = obj.timestamp
    if (!ts) continue
    const uuid = obj.uuid
    if (uuid && seen.has(uuid)) continue
    if (uuid) seen.add(uuid)
    const d = new Date(ts)
    if (isNaN(d.getTime())) continue
    matrix[d.getDay()][d.getHours()] += 1
    const key = d.toISOString().slice(0, 10)
    dailyMsgs.set(key, (dailyMsgs.get(key) || 0) + 1)
    total += 1
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

function computeMyStats() {
  const today = new Date()
  const keyFor = (offset) => {
    const d = new Date(today)
    d.setDate(d.getDate() - offset)
    return d.toISOString().slice(0, 10)
  }
  let last7dMsgs = 0, last30dMsgs = 0
  for (let i = 0; i < 7; i++) last7dMsgs += dailyMsgs.get(keyFor(i)) || 0
  for (let i = 0; i < 30; i++) last30dMsgs += dailyMsgs.get(keyFor(i)) || 0
  let streak = 0
  for (let i = 0; i < 365; i++) {
    if ((dailyMsgs.get(keyFor(i)) || 0) > 0) streak++
    else break
  }
  return {
    last7dMsgs,
    last30dMsgs,
    totalMsgs: total,
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
      execSync('git push', { cwd: LB_REPO_DIR, ...opts })
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

fs.mkdirSync(CACHE_DIR, { recursive: true })
fs.writeFileSync(TMP, JSON.stringify(daily))
fs.renameSync(TMP, OUT)
