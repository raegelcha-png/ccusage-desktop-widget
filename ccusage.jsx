export const command = "cat /Users/raegalcha/.ccusage-widget/data.json"

export const refreshFrequency = 600000

const loadJSON = (key, fallback) => {
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}
const saveJSON = (key, val) => {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

const savedPos = loadJSON('ccusage-pos', { x: null, y: 40 })
const savedSize = loadJSON('ccusage-size', { w: 280 })
const savedView = loadJSON('ccusage-view', 'daily')
const savedWeekdaysOnly = loadJSON('ccusage-weekdays-only', false)

export const initialState = {
  view: savedView,
  weekdaysOnly: savedWeekdaysOnly,
  hoverIdx: null,
  output: '',
  error: null,
  pos: savedPos,
  size: savedSize
}

export const updateState = (event, prev) => {
  if (!event) return prev
  if (event.type === 'SET_VIEW') {
    saveJSON('ccusage-view', event.view)
    return { ...prev, view: event.view }
  }
  if (event.type === 'SET_WEEKDAYS') {
    saveJSON('ccusage-weekdays-only', event.value)
    return { ...prev, weekdaysOnly: event.value }
  }
  if (event.type === 'SET_HOVER') return { ...prev, hoverIdx: event.idx }
  if (event.type === 'SET_POS') return { ...prev, pos: { x: event.x, y: event.y } }
  if (event.type === 'SET_SIZE') return { ...prev, size: { w: event.w } }
  if (event.type === 'UB/COMMAND_RAN') return { ...prev, output: event.output, error: event.error }
  return prev
}

export const className = `
  top: 0;
  left: 0;
  width: 0;
  height: 0;
`

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtDate = (iso) => {
  if (!iso) return ''
  const parts = iso.split('-')
  if (parts.length < 3) return iso
  return `${parseInt(parts[2], 10)} ${MONTHS[parseInt(parts[1], 10) - 1]}`
}

const barNormal = 'rgba(255,255,255,0.55)'
const barCurrent = 'rgba(255,255,255,0.92)'
const barHot = '#ff9f0a'
const sparkStroke = 'rgba(255,255,255,0.85)'
const sparkAreaTop = 'rgba(255,255,255,0.28)'
const histBar = 'rgba(255,255,255,0.45)'
const histBarLast = 'rgba(255,255,255,0.92)'
const hoverAccent = '#0a84ff'
const hoverText = '#64d2ff'
const heatAccent = '#64d2ff'

const groupByWeek = (days) => {
  const weeks = new Map()
  for (const d of days) {
    const date = new Date(d.date + 'T00:00:00')
    const weekStart = new Date(date)
    weekStart.setDate(date.getDate() - date.getDay())
    const key = weekStart.toISOString().slice(0, 10)
    if (!weeks.has(key)) weeks.set(key, {
      date: key, totalCost: 0, totalTokens: 0,
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0
    })
    const w = weeks.get(key)
    w.totalCost += d.totalCost || 0
    w.totalTokens += d.totalTokens || 0
    w.inputTokens += d.inputTokens || 0
    w.outputTokens += d.outputTokens || 0
    w.cacheReadTokens += d.cacheReadTokens || 0
    w.cacheCreationTokens += d.cacheCreationTokens || 0
  }
  return Array.from(weeks.values()).sort((a, b) => a.date.localeCompare(b.date))
}

const Sparkline = ({ data, w, h, paddingX = 2, hoverIdx = null }) => {
  if (!data || data.length < 2) return null
  const max = Math.max(...data.map(d => d.totalCost || 0), 0.01)
  const xs = data.map((_, i) => (i / (data.length - 1)) * (w - paddingX * 2) + paddingX)
  const ys = data.map(d => h - (((d.totalCost || 0) / max) * (h - 6)) - 3)
  const linePts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  const areaPts = `${xs[0].toFixed(1)},${h} ${linePts} ${xs[xs.length-1].toFixed(1)},${h}`
  const lastX = xs[xs.length-1], lastY = ys[ys.length-1]
  const showHover = hoverIdx != null && hoverIdx >= 0 && hoverIdx < data.length
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="sparkArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sparkAreaTop} />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <polyline points={areaPts} fill="url(#sparkArea)" stroke="none" />
      <polyline points={linePts} fill="none" stroke={sparkStroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.6" fill="#fff" />
      {showHover && (
        <g>
          <line x1={xs[hoverIdx]} y1={0} x2={xs[hoverIdx]} y2={h} stroke="rgba(10,132,255,0.4)" strokeWidth="1" strokeDasharray="2 2" />
          <circle cx={xs[hoverIdx]} cy={ys[hoverIdx]} r="3.2" fill={hoverAccent} stroke="#fff" strokeWidth="1.2" />
        </g>
      )}
    </svg>
  )
}

const Histogram = ({ data, w, h, hoverIdx = null, onHover }) => {
  if (!data || !data.length) return null
  const max = Math.max(...data.map(d => d.totalCost || 0), 0.01)
  const gap = 2
  const barW = Math.max(2, (w - gap * (data.length - 1)) / data.length)
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {data.map((d, i) => {
        const bh = Math.max(1.5, ((d.totalCost || 0) / max) * h)
        const x = i * (barW + gap)
        const isLast = i === data.length - 1
        const isHover = i === hoverIdx
        const fill = isHover ? hoverAccent : (isLast ? histBarLast : histBar)
        return (
          <rect
            key={d.date}
            x={x}
            y={h - bh}
            width={barW}
            height={bh}
            rx="1"
            fill={fill}
            style={{
              cursor: 'pointer',
              transition: 'fill 0.12s ease',
              filter: isHover ? 'drop-shadow(0 0 3px rgba(10,132,255,0.55))' : 'none'
            }}
            onMouseEnter={() => onHover && onHover(i)}
            onMouseLeave={() => onHover && onHover(null)}
          />
        )
      })}
    </svg>
  )
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const hourLabel = (h) => h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`
const hourLabelFull = (h) => h === 0 ? '12AM' : h === 12 ? '12PM' : h < 12 ? `${h}AM` : `${h - 12}PM`

const Heatmap = ({ hotspot, w }) => {
  if (!hotspot || !hotspot.matrix || !hotspot.peak) {
    return <div style={{ fontSize: 10, opacity: 0.6, textAlign: 'center', padding: '18px 0' }}>no hotspot data yet — cache refresh pending</div>
  }
  const { matrix, peak, topDay, topHour, dayTotals, hourTotals, total } = hotspot
  const dayOrder = [1, 2, 3, 4, 5, 6, 0]
  const labelW = 14
  const gridW = w - labelW
  const gap = 1
  const cellW = gridW / 24
  const cellH = 11
  const cellDraw = Math.max(3, cellW - gap)
  const svgH = 7 * (cellH + gap)
  return (
    <div>
      <svg width={w} height={svgH} style={{ display: 'block', overflow: 'visible' }}>
        {dayOrder.map((d, row) => (
          <g key={d}>
            <text
              x={0}
              y={row * (cellH + gap) + cellH / 2 + 3}
              fontSize="8"
              fill="rgba(255,255,255,0.45)"
              fontFamily="-apple-system,SF Pro Text,Helvetica"
              letterSpacing="0.5"
            >
              {DAY_LETTERS[d]}
            </text>
            {matrix[d].map((v, h) => {
              const o = peak > 0 ? v / peak : 0
              const isPeak = d === topDay && h === topHour
              return (
                <rect
                  key={h}
                  x={labelW + h * cellW}
                  y={row * (cellH + gap)}
                  width={cellDraw}
                  height={cellH}
                  rx="1.5"
                  fill={isPeak ? heatAccent : `rgba(255,255,255,${(0.05 + o * 0.72).toFixed(3)})`}
                />
              )
            })}
          </g>
        ))}
      </svg>
      <div style={{
        position: 'relative',
        height: 10,
        marginTop: 3,
        marginLeft: labelW,
        fontSize: 8,
        opacity: 0.45,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: 0.2
      }}>
        {[0, 6, 12, 18].map(h => (
          <span key={h} style={{
            position: 'absolute',
            left: h * cellW + cellDraw / 2,
            transform: 'translateX(-50%)'
          }}>
            {hourLabel(h)}
          </span>
        ))}
        <span style={{ position: 'absolute', right: 0 }}>12a</span>
      </div>
      <div style={{
        marginTop: 10,
        fontSize: 10,
        lineHeight: 1.5,
        opacity: 0.88
      }}>
        <div>
          Most active{' '}
          <span style={{ color: heatAccent, fontWeight: 600 }}>{DAY_NAMES_FULL[topDay]}s</span>
          {' around '}
          <span style={{ color: heatAccent, fontWeight: 600 }}>{hourLabelFull(topHour)}</span>
        </div>
        <div style={{ fontSize: 9, opacity: 0.55, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          {peak} msgs in peak hour · {total.toLocaleString()} total
        </div>
      </div>
    </div>
  )
}

const Leaderboard = ({ lb, w }) => {
  if (!lb || !lb.participants || !lb.participants.length) {
    return (
      <div style={{ fontSize: 10, opacity: 0.65, textAlign: 'center', padding: '16px 4px', lineHeight: 1.55 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>leaderboard not set up</div>
        <div style={{ fontSize: 9, opacity: 0.7 }}>
          create a private repo, then:<br/>
          <span style={{ fontFamily: 'SF Mono, monospace', opacity: 0.9 }}>
            ~/.ccusage-widget/leaderboard.config.json
          </span>
        </div>
      </div>
    )
  }
  const me = lb.myHandle
  const sorted = [...lb.participants].sort((a, b) => (b.last7dMsgs || 0) - (a.last7dMsgs || 0))
  const max = Math.max(...sorted.map(p => p.last7dMsgs || 0), 1)
  const myRank = sorted.findIndex(p => p.handle === me) + 1
  return (
    <div>
      {sorted.slice(0, 8).map((p, i) => {
        const isMe = p.handle === me
        const pct = ((p.last7dMsgs || 0) / max) * 100
        const rank = i + 1
        return (
          <div key={p.handle} style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: 4,
            fontSize: 10,
            opacity: isMe ? 1 : 0.85
          }}>
            <div style={{
              width: 14,
              fontSize: 9,
              opacity: 0.5,
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'right',
              marginRight: 6
            }}>
              {rank}
            </div>
            <div style={{
              width: 78,
              fontWeight: isMe ? 600 : 400,
              color: isMe ? heatAccent : '#f5f5f7',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {p.handle}
            </div>
            <div style={{
              flex: 1,
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 3,
              height: 8,
              marginRight: 7,
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${pct}%`,
                height: '100%',
                background: isMe ? heatAccent : barNormal,
                borderRadius: 3,
                transition: 'width 0.4s ease'
              }} />
            </div>
            <div style={{
              width: 42,
              textAlign: 'right',
              opacity: 0.85,
              fontVariantNumeric: 'tabular-nums',
              fontWeight: isMe ? 600 : 400
            }}>
              {(p.last7dMsgs || 0).toLocaleString()}
            </div>
          </div>
        )
      })}
      <div style={{
        fontSize: 9,
        opacity: 0.5,
        marginTop: 6,
        display: 'flex',
        justifyContent: 'space-between',
        letterSpacing: 0.3,
        fontVariantNumeric: 'tabular-nums'
      }}>
        <span>7-day messages</span>
        {myRank > 0 && (() => {
          const myEntry = sorted.find(p => p.handle === me)
          const streak = myEntry && typeof myEntry.streak === 'number' ? myEntry.streak : null
          return <span>you: #{myRank}{streak != null ? ` · streak ${streak}d` : ''}</span>
        })()}
      </div>
    </div>
  )
}

const GripDots = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" style={{ display: 'block' }}>
    {[[3,9],[6,9],[9,9],[6,6],[9,6],[9,3]].map(([cx,cy], i) => (
      <circle key={i} cx={cx} cy={cy} r="0.9" fill="rgba(255,255,255,0.45)" />
    ))}
  </svg>
)

export const render = ({ output, error, view, pos, size, weekdaysOnly, hoverIdx }, dispatch) => {
  const currentView = view || 'daily'
  const wdOnly = !!weekdaysOnly
  const width = (size && size.w) || 280
  const yPos = (pos && pos.y != null) ? pos.y : 40
  const xPos = (pos && pos.x != null)
    ? pos.x
    : (typeof window !== 'undefined' ? window.innerWidth - width - 40 : 40)

  const rootStyle = {
    position: 'fixed',
    left: xPos,
    top: yPos,
    width: width,
    padding: '14px 16px 12px',
    background: 'rgba(22, 22, 28, 0.70)',
    borderRadius: 12,
    color: '#f5f5f7',
    fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif",
    WebkitBackdropFilter: 'blur(30px) saturate(180%)',
    backdropFilter: 'blur(30px) saturate(180%)',
    boxShadow: '0 6px 28px rgba(0,0,0,0.32), inset 0 0 0 0.5px rgba(255,255,255,0.08)',
    fontSize: 11,
    lineHeight: 1.35,
    userSelect: 'none'
  }

  if (error) {
    return <div style={{ ...rootStyle, color: '#ff8080' }}>widget error: {String(error)}</div>
  }
  if (!output || output.trim() === '') {
    return <div style={{ ...rootStyle, padding: '18px 16px', textAlign: 'center', opacity: 0.7 }}>loading ccusage…</div>
  }

  let data
  try {
    const jsonStart = output.indexOf('{')
    data = JSON.parse(output.slice(jsonStart))
  } catch (e) {
    return <div style={{ ...rootStyle, color: '#ff8080' }}>parse error</div>
  }

  const allDays = data.daily || []
  const isWeekend = (dateStr) => {
    const dow = new Date(dateStr + 'T00:00:00').getDay()
    return dow === 0 || dow === 6
  }
  const dailyPool = wdOnly ? allDays.filter(d => !isWeekend(d.date)) : allDays
  const buckets = currentView === 'weekly' ? groupByWeek(allDays).slice(-12) : dailyPool.slice(-7)
  if (!buckets.length) return <div style={rootStyle}>no usage data</div>

  const periodTotal = buckets.reduce((s, d) => s + (d.totalCost || 0), 0)
  const current = buckets[buckets.length - 1]
  const currentCost = current?.totalCost || 0
  const currentLabel = currentView === 'weekly' ? 'This Week' : 'Today'
  const totalLabel = currentView === 'weekly' ? `${buckets.length}w total` : `${buckets.length}d total`
  const avg = periodTotal / buckets.length
  const hotThreshold = currentView === 'weekly' ? 300 : 100

  const last30 = allDays.slice(-30)
  const last30Avg = last30.length ? last30.reduce((s,d)=>s+(d.totalCost||0),0) / last30.length : 0
  const today = new Date()
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const projectionEOM = last30Avg * daysInMonth

  let cacheReads = 0, totalReads = 0
  for (const d of last30) {
    cacheReads += d.cacheReadTokens || 0
    totalReads += (d.inputTokens || 0) + (d.cacheReadTokens || 0)
  }
  const cacheHitPct = totalReads > 0 ? (cacheReads / totalReads) * 100 : null

  const startDrag = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startMX = e.clientX, startMY = e.clientY
    const origX = xPos, origY = yPos
    let latestX = origX, latestY = origY
    document.body.style.cursor = 'grabbing'
    const onMove = (ev) => {
      latestX = origX + ev.clientX - startMX
      latestY = origY + ev.clientY - startMY
      dispatch({ type: 'SET_POS', x: latestX, y: latestY })
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      saveJSON('ccusage-pos', { x: latestX, y: latestY })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const startResize = (e) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const startMX = e.clientX
    const origW = width
    let latestW = origW
    const onMove = (ev) => {
      latestW = Math.max(240, Math.min(520, origW + ev.clientX - startMX))
      dispatch({ type: 'SET_SIZE', w: latestW })
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      saveJSON('ccusage-size', { w: latestW })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const pillStyle = (active) => ({
    padding: '2px 9px',
    fontSize: 9.5,
    fontWeight: 600,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    borderRadius: 999,
    cursor: 'pointer',
    background: active ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)',
    color: active ? '#ffffff' : 'rgba(255,255,255,0.45)',
    border: active ? '0.5px solid rgba(255,255,255,0.28)' : '0.5px solid rgba(255,255,255,0.06)',
    transition: 'all 0.15s ease'
  })

  const metricLabel = { fontSize: 8.5, letterSpacing: 0.8, textTransform: 'uppercase', opacity: 0.45 }
  const metricValue = { fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums', opacity: 0.9, marginTop: 1 }

  const chartW = width - 32
  const maxCostDaily = currentView === 'daily'
    ? Math.max(...buckets.map(d => d.totalCost || 0), 0.01)
    : 0

  return (
    <div style={rootStyle}>
      <div
        onMouseDown={startDrag}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          paddingBottom: 10,
          marginBottom: 10,
          borderBottom: '0.5px solid rgba(255,255,255,0.08)',
          cursor: 'grab'
        }}
      >
        <div>
          <div style={{ fontSize: 9, letterSpacing: 1, opacity: 0.5, textTransform: 'uppercase' }}>{totalLabel}</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2, letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' }}>${periodTotal.toFixed(2)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 9, letterSpacing: 1, opacity: 0.5, textTransform: 'uppercase' }}>{currentLabel}</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2, letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' }}>${currentCost.toFixed(2)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 5, marginBottom: 10, alignItems: 'center' }}>
        <div style={pillStyle(currentView === 'daily')} onClick={() => dispatch({ type: 'SET_VIEW', view: 'daily' })}>Daily</div>
        <div style={pillStyle(currentView === 'weekly')} onClick={() => dispatch({ type: 'SET_VIEW', view: 'weekly' })}>Weekly</div>
        <div style={pillStyle(currentView === 'hotspot')} onClick={() => dispatch({ type: 'SET_VIEW', view: 'hotspot' })}>Hotspot</div>
        <div style={pillStyle(currentView === 'leaderboard')} onClick={() => dispatch({ type: 'SET_VIEW', view: 'leaderboard' })}>Friends</div>
        {currentView === 'daily' && (
          <div
            style={{ ...pillStyle(wdOnly), marginLeft: 'auto' }}
            onClick={() => dispatch({ type: 'SET_WEEKDAYS', value: !wdOnly })}
            title={wdOnly ? 'showing weekdays only' : 'showing all days'}
          >
            {wdOnly ? 'Mon–Fri' : 'All days'}
          </div>
        )}
      </div>

      {currentView === 'leaderboard' ? (
        <Leaderboard lb={data.leaderboard} w={chartW} />
      ) : currentView === 'hotspot' ? (
        <Heatmap hotspot={data.hotspot} w={chartW} />
      ) : currentView === 'daily' ? (
        <div>
          {buckets.map((d, i) => {
            const w = Math.max(((d.totalCost || 0) / maxCostDaily) * 100, 1.5)
            const isCurrent = i === buckets.length - 1
            const hot = (d.totalCost || 0) >= hotThreshold
            const barBg = hot ? barHot : (isCurrent ? barCurrent : barNormal)
            return (
              <div key={d.date} style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 4,
                fontSize: 10,
                opacity: isCurrent ? 1 : 0.88
              }}>
                <div style={{ width: 44, opacity: 0.5, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(d.date)}</div>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 3, height: 10, marginRight: 7, overflow: 'hidden' }}>
                  <div style={{
                    width: `${w}%`,
                    height: '100%',
                    background: barBg,
                    borderRadius: 3,
                    boxShadow: isCurrent ? '0 0 6px rgba(255,255,255,0.22)' : 'none',
                    transition: 'width 0.4s ease'
                  }} />
                </div>
                <div style={{
                  width: 46,
                  textAlign: 'right',
                  opacity: 0.85,
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: isCurrent ? 600 : 400
                }}>
                  ${(d.totalCost || 0).toFixed(2)}
                </div>
              </div>
            )
          })}
        </div>
      ) : (() => {
        const N = buckets.length
        const gap = 2
        const barW = Math.max(2, (chartW - gap * (N - 1)) / N)
        const centerX = (i) => i * (barW + gap) + barW / 2
        const hIdx = (hoverIdx != null && hoverIdx >= 0 && hoverIdx < N) ? hoverIdx : null
        const hovered = hIdx != null ? buckets[hIdx] : null
        return (
          <div>
            <div style={{
              height: 14,
              position: 'relative',
              marginBottom: 2,
              fontSize: 9,
              letterSpacing: 0.3,
              fontVariantNumeric: 'tabular-nums',
              opacity: hovered ? 0.9 : 0,
              transition: 'opacity 0.12s ease'
            }}>
              {hovered && (
                <div style={{
                  position: 'absolute',
                  left: Math.max(30, Math.min(chartW - 30, centerX(hIdx))),
                  transform: 'translateX(-50%)',
                  whiteSpace: 'nowrap',
                  color: hoverText,
                  fontWeight: 600
                }}>
                  Wk of {fmtDate(hovered.date)} · ${(hovered.totalCost || 0).toFixed(2)}
                </div>
              )}
            </div>
            <Sparkline data={buckets} w={chartW} h={46} paddingX={barW / 2} hoverIdx={hIdx} />
            <Histogram
              data={buckets}
              w={chartW}
              h={22}
              hoverIdx={hIdx}
              onHover={(i) => dispatch({ type: 'SET_HOVER', idx: i })}
            />
            <div style={{
              position: 'relative',
              height: 12,
              marginTop: 4,
              fontSize: 8.5,
              opacity: 0.45,
              letterSpacing: 0.3,
              fontVariantNumeric: 'tabular-nums'
            }}>
              <span style={{ position: 'absolute', left: centerX(0), transform: 'translateX(-50%)' }}>
                {fmtDate(buckets[0].date)}
              </span>
              <span style={{ position: 'absolute', left: centerX(N - 1), transform: 'translateX(-50%)' }}>
                {fmtDate(buckets[N - 1].date)}
              </span>
            </div>
          </div>
        )
      })()}

      <div style={{
        marginTop: 12,
        paddingTop: 10,
        borderTop: '0.5px solid rgba(255,255,255,0.08)',
        display: 'grid',
        gridTemplateColumns: cacheHitPct != null ? '1fr 1fr 1fr' : '1fr 1fr',
        gap: 8
      }}>
        <div>
          <div style={metricLabel}>Avg/{currentView === 'weekly' ? 'wk' : 'day'}</div>
          <div style={metricValue}>${avg.toFixed(2)}</div>
        </div>
        <div>
          <div style={metricLabel}>EOM proj.</div>
          <div style={metricValue}>${projectionEOM.toFixed(0)}</div>
        </div>
        {cacheHitPct != null && (
          <div>
            <div style={metricLabel}>Cache hit</div>
            <div style={metricValue}>{cacheHitPct.toFixed(0)}%</div>
          </div>
        )}
      </div>

      <div style={{
        marginTop: 8,
        fontSize: 8.5,
        opacity: 0.35,
        textAlign: 'right',
        letterSpacing: 0.4,
        fontVariantNumeric: 'tabular-nums'
      }}>
        {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>

      <div
        onMouseDown={startResize}
        title="drag to resize"
        style={{
          position: 'absolute',
          right: 3,
          bottom: 3,
          cursor: 'ew-resize',
          opacity: 0.55,
          padding: 1
        }}
      >
        <GripDots />
      </div>
    </div>
  )
}
