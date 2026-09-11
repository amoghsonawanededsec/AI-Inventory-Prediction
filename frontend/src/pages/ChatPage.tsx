import { FormEvent, useEffect, useRef, useState } from 'react'
import { Bot, Cpu, RefreshCw, Send, Sparkles, User as UserIcon } from 'lucide-react'
import { api } from '../lib/api'

type Message = {
  role: 'user' | 'assistant'
  content: string
  citations?: { title: string; section: string }[]
  time?: string
}

const SUGGESTED_QUESTIONS = [
  'Which products are low on stock right now?',
  'Which products are likely to expire this week?',
  'How much Basmati Rice should I order next week?',
  'Which products have the highest waste risk?',
  'What is our total revenue this month?',
  'Explain the safety stock policy.'
]

export default function ChatPage() {
  const [modelName, setModelName] = useState('Grounded Decision Support')
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        'Hi! I am your Stockwise AI decision support assistant. I am connected to live operational inventory databases, demand forecasting models, and policy knowledge retrieval. Ask me about real-time stock levels, demand forecasts, expiry dates, surplus waste risks, purchase orders, suppliers, or what-if scenarios.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ])
  const [text, setText] = useState('')
  const [conversationId, setConversationId] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api<{ llm_model?: string }>('/api/system/info')
      .then(res => {
        if (res.llm_model) setModelName(res.llm_model)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    try {
      if (endRef.current && typeof endRef.current.scrollIntoView === 'function') {
        endRef.current.scrollIntoView({ behavior: 'smooth' })
      }
    } catch {
      // Safely ignore in environments without scrollIntoView
    }
  }, [messages, busy])

  async function ask(value: string) {
    const query = value.trim()
    if (!query || busy) return

    const userMsg: Message = {
      role: 'user',
      content: query,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    setMessages(prev => [...prev, userMsg])
    setText('')
    setBusy(true)
    setError('')

    try {
      const result = await api<{
        conversation_id: number
        response: string
        citations: { title: string; section: string }[]
      }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: query, conversation_id: conversationId })
      })

      setConversationId(result.conversation_id)
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: result.response,
          citations: result.citations,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not communicate with the AI assistant')
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    ask(text)
  }

  function resetChat() {
    setConversationId(undefined)
    setMessages([
      {
        role: 'assistant',
        content:
          'Started a fresh session. How can I assist your inventory operations today?',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ])
    setError('')
  }

  return (
    <div className="chat-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">GROUNDED INTELLIGENCE &amp; REASONING</p>
          <h1>Inventory AI Assistant</h1>
          <p>
            Connected to live operational database tools, ML forecasts, and policy RAG retrieval.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span className="ai-pill" title={`Model: ${modelName}`}>
            <Cpu size={14} /> {modelName}
          </span>
          <span className="ai-pill" style={{ background: '#ecfdf5', color: '#065f46', borderColor: '#a7f3d0' }}>
            <Sparkles size={14} /> Live Tools Active
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={resetChat}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            title="Start new conversation"
          >
            <RefreshCw size={14} /> New Chat
          </button>
        </div>
      </header>

      <section className="chat-layout">
        <div className="chat-panel">
          <div className="chat-messages">
            {messages.map((message, i) => (
              <div key={i} className={`message ${message.role}`}>
                <div className="message-avatar">
                  {message.role === 'assistant' ? <Bot size={18} /> : <UserIcon size={18} />}
                </div>
                <div className="message-bubble">
                  <div className="message-header-meta">
                    <strong>{message.role === 'assistant' ? 'Stockwise AI' : 'You'}</strong>
                    {message.time && <span className="message-time">{message.time}</span>}
                  </div>
                  <p style={{ whiteSpace: 'pre-line' }}>{message.content}</p>
                  {message.citations && message.citations.length > 0 && (
                    <div className="citations-block">
                      {message.citations.map((c, idx) => (
                        <span className="citation" key={idx}>
                          Source: <strong>{c.title}</strong> ({c.section})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {busy && (
              <div className="message assistant">
                <div className="message-avatar">
                  <Bot size={18} />
                </div>
                <div className="message-bubble">
                  <p className="typing">
                    <span className="dot"></span>
                    <span className="dot"></span>
                    <span className="dot"></span>
                    Querying live inventory &amp; reasoning…
                  </p>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {error && <div className="form-error" style={{ margin: '0.5rem 1rem' }}>{error}</div>}

          <form className="chat-input" onSubmit={submit}>
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Ask about inventory, low stock, demand forecast, expiry risk, reorders..."
              disabled={busy}
              id="chat-user-input"
            />
            <button
              type="submit"
              className="primary-button"
              disabled={busy || !text.trim()}
              aria-label="Send message"
              id="chat-send-btn"
            >
              <Send size={16} />
            </button>
          </form>
        </div>

        <aside className="chat-aside">
          <h2>Suggested Queries</h2>
          <div className="suggested-list">
            {SUGGESTED_QUESTIONS.map(q => (
              <button
                key={q}
                type="button"
                className="suggested-btn"
                onClick={() => ask(q)}
                disabled={busy}
              >
                {q}
              </button>
            ))}
          </div>

          <div className="grounding-note">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <Sparkles size={16} color="#0f766e" />
              <strong>Grounded Authority</strong>
            </div>
            <p>
              Quantitative numbers and dates are strictly resolved from authoritative SQL queries.
              The AI reasoning model articulates answers clearly without hallucinating inventory numbers.
            </p>
          </div>
        </aside>
      </section>
    </div>
  )
}
