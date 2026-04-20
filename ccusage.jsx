export const command = "cat /Users/raegalcha/.ccusage-widget/data.json"

export const refreshFrequency = 600000

export const initialState = { view: 'daily', output: '', error: null }

export const updateState = (event, previousState) => {
  if (event && event.type === 'SET_VIEW') {
    return { ...previousState, view: event.view }
  }
  if (event && event.type === 'UB/COMMAND_RAN') {
    return { ...previousState, output: event.output, error: event.error }
  }
  return previousState
}

export const className = `
  top: 40px;
  right: 40px;
  width: 360px;
  padding: 18px 20px;
  background: rgba(18, 20, 28, 0.82);
  border-radius: 14px;
  color: #f5f5f7;
  font-family: -apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif;
  -webkit-backdrop-filter: blur(24px);
  backdrop-filter: blur(24px);
  box-shadow: 0 10px 36px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.06);
`

const gradient = 'linear-gradient(90deg, #4f8cff 0%, #a855f7 100%)'
const gradientHot = 'linear-gradient(90deg, #ff6b6b 0%, #ffa94d 100%)'

const groupByWeek = (days) => {
  const weeks = new Map()
  for (const d of days) {
    const date = new Date(d.date + 'T00:00:00')
    const dow = date.getDay()
    const weekStart = new Date(date)
    weekStart.setDate(date.getDate() - dow)
    const key = weekStart.toISOString().slice(0, 10)
    if (!weeks.has(key)) {
      weeks.set(key, { date: key, totalCost: 0, totalTokens: 0 })
    }
    const w = weeks.get(key)
    w.totalCost += d.totalCost
    w.totalTokens += (d.totalTokens || 0)
  }
  return Array.from(weeks.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export const render = ({ output, error, view }, dispatch) => {
  const currentView = view || 'daily'

  if (error) {
    return <div style={{ fontSize: 12, color: '#ff8080' }}>widget error: {String(error)}</div>
  }
  if (!output || output.trim() === '') {
    return <div style={{ fontSize: 12, opacity: 0.7, padding: '20px 4px', textAlign: 'center' }}>loading ccusage… (first run ~20s)</div>
  }

  let data
  try {
    const jsonStart = output.indexOf('{')
    data = JSON.parse(output.slice(jsonStart))
  } catch (e) {
    return (
      <div style={{ fontSize: 11, color: '#ff8080', whiteSpace: 'pre-wrap' }}>
        parse error{"\n"}{output.slice(0, 200)}
      </div>
    )
  }

  const allDays = data.daily || []
  const buckets = currentView === 'weekly'
    ? groupByWeek(allDays).slice(-10)
    : allDays.slice(-14)

  if (buckets.length === 0) {
    return <div style={{ fontSize: 12, opacity: 0.7 }}>no usage data</div>
  }

  const maxCost = Math.max(...buckets.map(d => d.totalCost), 0.01)
  const periodTotal = buckets.reduce((s, d) => s + d.totalCost, 0)
  const current = buckets[buckets.length - 1]
  const currentCost = current?.totalCost || 0
  const currentLabel = currentView === 'weekly' ? 'This Week' : 'Today'
  const totalLabel = currentView === 'weekly' ? `${buckets.length}w total` : `${buckets.length}d total`
  const hotThreshold = currentView === 'weekly' ? 300 : 100

  const pillStyle = (active) => ({
    padding: '3px 10px',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    borderRadius: 999,
    cursor: 'pointer',
    background: active ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.05)',
    color: active ? '#e9d5ff' : 'rgba(255,255,255,0.5)',
    border: active ? '1px solid rgba(168,85,247,0.5)' : '1px solid rgba(255,255,255,0.08)',
    transition: 'all 0.15s ease',
    userSelect: 'none'
  })

  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 12,
        paddingBottom: 12,
        borderBottom: '1px solid rgba(255,255,255,0.08)'
      }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1.2, opacity: 0.55, textTransform: 'uppercase' }}>{currentLabel}</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>${currentCost.toFixed(2)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, letterSpacing: 1.2, opacity: 0.55, textTransform: 'uppercase' }}>{totalLabel}</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>${periodTotal.toFixed(2)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <div
          style={pillStyle(currentView === 'daily')}
          onClick={() => dispatch({ type: 'SET_VIEW', view: 'daily' })}
        >
          Daily
        </div>
        <div
          style={pillStyle(currentView === 'weekly')}
          onClick={() => dispatch({ type: 'SET_VIEW', view: 'weekly' })}
        >
          Weekly
        </div>
      </div>

      <div>
        {buckets.map((d, i) => {
          const w = Math.max((d.totalCost / maxCost) * 100, 1.5)
          const isCurrent = i === buckets.length - 1
          const hot = d.totalCost >= hotThreshold
          const barBg = hot ? gradientHot : gradient
          const label = currentView === 'weekly' ? d.date.slice(5) : d.date.slice(5)
          return (
            <div key={d.date} style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: 5,
              fontSize: 10.5,
              opacity: isCurrent ? 1 : 0.92
            }}>
              <div style={{ width: 42, opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>{label}</div>
              <div style={{
                flex: 1,
                background: 'rgba(255,255,255,0.06)',
                borderRadius: 4,
                height: 14,
                marginRight: 8,
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${w}%`,
                  height: '100%',
                  background: barBg,
                  borderRadius: 4,
                  boxShadow: isCurrent ? '0 0 8px rgba(168,85,247,0.4)' : 'none',
                  transition: 'width 0.4s ease'
                }} />
              </div>
              <div style={{
                width: 58,
                textAlign: 'right',
                opacity: 0.85,
                fontVariantNumeric: 'tabular-nums',
                fontWeight: isCurrent ? 600 : 400
              }}>
                ${d.totalCost.toFixed(2)}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{
        marginTop: 12,
        paddingTop: 10,
        borderTop: '1px solid rgba(255,255,255,0.08)',
        fontSize: 9.5,
        opacity: 0.4,
        textAlign: 'right',
        letterSpacing: 0.5
      }}>
        refreshed {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}
