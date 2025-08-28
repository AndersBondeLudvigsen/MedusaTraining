require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')

const app = express()
app.use(bodyParser.json({ limit: '1mb' }))

const PORT = process.env.PORT || 8765
const TOKEN = process.env.MCP_SERVER_TOKEN || ''

function auth(req, res, next) {
  const hdr = req.headers['authorization'] || ''
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : ''
  if (!TOKEN || token !== TOKEN) {
    return res.status(401).json({ message: 'Unauthorized' })
  }
  next()
}

// Extremely minimal agent: echoes question, optionally calls provided tools
// Expected payload: { question: string, tools: [{ name, invocation: { method, url, headers }, parameters? }], system? }
app.post('/chat', auth, async (req, res) => {
  const { question, tools = [] } = req.body || {}
  const text = String(question || '').trim().toLowerCase()

  // Very naive intent: if it contains 'orders' and a duration, call count_orders tool with that duration.
  const countTool = tools.find(t => t.name === 'count_orders' && t.invocation && t.invocation.url)

  const durationMatch = text.match(/last\s*(\d+)\s*(s|m|h|d|w|M|y|seconds?|minutes?|hours?|days?|weeks?|months?|years?)/)

  if (countTool && /orders?/.test(text)) {
    try {
      const payload = {}
      if (durationMatch) {
        // Normalize units to short form used by Medusa tool
        const value = Number(durationMatch[1])
        const unit = durationMatch[2]
        const norm = {
          second: 's', seconds: 's', s: 's',
          minute: 'm', minutes: 'm', m: 'm',
          hour: 'h', hours: 'h', h: 'h',
          day: 'd', days: 'd', d: 'd',
          week: 'w', weeks: 'w', w: 'w',
          month: 'M', months: 'M', M: 'M',
          year: 'y', years: 'y', y: 'y',
        }[unit] || 'd'
        payload.last = `${value}${norm}`
      }

      const r = await fetch(countTool.invocation.url, {
        method: countTool.invocation.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(countTool.invocation.headers || {}),
        },
        body: JSON.stringify(payload),
      })

      if (!r.ok) {
        const txt = await r.text().catch(() => '')
        throw new Error(txt || `Tool responded ${r.status}`)
      }
      const data = await r.json()
      const { count, range } = data?.result || {}
      if (typeof count === 'number') {
        const from = range?.from || ''
        const to = range?.to || ''
        const answer = `Orders count ${from && to ? `from ${from} to ${to}` : ''}: ${count}.`
        return res.json({ answer, tool: 'count_orders', raw: data })
      }
    } catch (e) {
      return res.status(200).json({ answer: 'The tool call failed.', error: String(e) })
    }
  }

  // Default echo-style response
  return res.json({ answer: `I received your question: "${question}". Provide tools for me to compute answers.` })
})

app.get('/health', (req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`MCP agent listening on http://localhost:${PORT}`)
})
