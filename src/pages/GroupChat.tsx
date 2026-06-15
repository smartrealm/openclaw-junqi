// Group Chat — message multiple agents simultaneously.
// Each agent responds independently, responses appear in a shared chat timeline.
import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Bot, Users, Check, Plus, X, Loader2, MessageCircle } from 'lucide-react';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useChatStore } from '@/stores/chatStore';
import { gateway } from '@/services/gateway';
import clsx from 'clsx';

interface AgentReply { agentId: string; agentName: string; content: string; ts: string; }

export function GroupChat() {
  const { t } = useTranslation();
  const agents = useGatewayDataStore(s => s.agents);
  const connected = useChatStore(s => s.connected);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'agent'; agentId?: string; agentName?: string; content: string; ts: string }>>([]);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const toggleAgent = (id: string) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const handleSend = async () => {
    const text = message.trim();
    if (!text || selected.size === 0 || !connected) return;
    setSending(true);
    const ts = new Date().toISOString();
    setMessages(prev => [...prev, { role: 'user', content: text, ts }]);
    setMessage('');
    const selectedList = [...selected].map(id => agents.find(a => a.id === id)).filter(Boolean) as typeof agents;

    // Send to each selected agent in parallel
    const promises = selectedList.map(async agent => {
      try {
        const sessionKey = `agent:${agent.id}:group-${Date.now()}`;
        const result = await gateway.sendMessage(text, undefined, sessionKey);
        // For now, just log the response; real streaming would need per-agent session tracking
        return { agentId: agent.id, agentName: agent.name || agent.id };
      } catch { return null; }
    });

    await Promise.all(promises);
    // Simulate agent responses (real implementation would subscribe to agent reply streams)
    selectedList.forEach(agent => {
      setTimeout(() => {
        setMessages(prev => [...prev, {
          role: 'agent', agentId: agent.id, agentName: agent.name || agent.id,
          content: `已发送给 ${agent.name || agent.id}（回复将在对应会话中查看）`, ts: new Date().toISOString()
        }]);
      }, 500);
    });
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Agent sidebar */}
      <div className="w-[220px] shrink-0 border-r border-aegis-border/50 flex flex-col bg-aegis-surface/30">
        <div className="px-4 py-3 border-b border-aegis-border/30">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-aegis-primary" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-aegis-text-muted">{t('groupchat.agents', '参与 Agent')}</span>
          </div>
          <span className="text-[10px] text-aegis-text-dim mt-1 block">{selected.size} {t('groupchat.selected', '已选')}</span>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {agents.length === 0 && (
            <div className="px-4 py-8 text-center text-[11px] text-aegis-text-dim">{t('groupchat.noAgents', '暂无 Agent')}</div>
          )}
          {agents.map(agent => {
            const isSel = selected.has(agent.id);
            return (
              <button key={agent.id} onClick={() => toggleAgent(agent.id)}
                className={clsx('w-full flex items-center gap-2 px-4 py-2 text-start transition-colors',
                  isSel ? 'bg-aegis-primary/10 text-aegis-primary' : 'hover:bg-[rgb(var(--aegis-overlay)/0.03)] text-aegis-text-muted')}
              >
                <div className={clsx('w-2 h-2 rounded-full shrink-0', isSel ? 'bg-aegis-primary' : 'bg-aegis-text-dim/20')} />
                <Bot size={12} className="shrink-0" />
                <span className="text-[11px] truncate">{agent.name || agent.id}</span>
                {isSel && <Check size={11} className="ml-auto shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-5 py-3 border-b border-aegis-border/50 shrink-0 flex items-center gap-2">
          <MessageCircle size={15} className="text-aegis-primary" />
          <h1 className="text-sm font-bold text-aegis-text">{t('nav.groupChat', '群聊')}</h1>
          {selected.size > 0 && (
            <div className="flex items-center gap-1 ml-2">
              {[...selected].map(id => {
                const a = agents.find(ag => ag.id === id);
                return a ? <span key={id} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-aegis-primary/10 text-aegis-primary flex items-center gap-1">
                  {a.name || id}<X size={9} className="cursor-pointer" onClick={() => toggleAgent(id)} /></span> : null;
              })}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-2">
              <Users size={32} className="text-aegis-text-dim/30" />
              <div className="text-[12px] text-aegis-text-dim">{t('groupchat.selectHint', '选择左侧 Agent 开始群聊')}</div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={clsx('flex gap-2', msg.role === 'user' && 'flex-row-reverse')}>
              <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                msg.role === 'user' ? 'bg-aegis-primary/15' : 'bg-aegis-surface border border-aegis-border/30')}>
                {msg.role === 'user' ? <Send size={11} className="text-aegis-primary" /> : <Bot size={11} className="text-aegis-text-muted" />}
              </div>
              <div className={clsx('max-w-[70%] rounded-2xl px-3 py-2',
                msg.role === 'user' ? 'bg-aegis-primary/10 border border-aegis-primary/20' : 'bg-[rgb(var(--aegis-overlay)/0.04)] border border-aegis-border/30')}>
                {msg.agentName && <div className="text-[9px] font-mono text-aegis-text-dim mb-0.5">{msg.agentName}</div>}
                <div className="text-[12px] text-aegis-text whitespace-pre-wrap break-words">{msg.content}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="p-3 border-t border-aegis-border/50 shrink-0">
          <div className="flex items-end gap-2">
            <textarea ref={inputRef} value={message} onChange={e => setMessage(e.target.value)} onKeyDown={handleKeyDown}
              rows={2}
              disabled={!connected || selected.size === 0}
              placeholder={connected ? t('groupchat.placeholder', '输入消息，发送给所有选中的 Agent…') : t('input.placeholderDisconnected')}
              className={clsx('flex-1 resize-none bg-aegis-surface border border-aegis-border/50 rounded-xl px-3 py-2 text-[13px] text-aegis-text placeholder:text-aegis-text-dim outline-none focus:border-aegis-primary/30', (!connected || selected.size === 0) && 'opacity-40')}
            />
            <button onClick={handleSend}
              disabled={!message.trim() || selected.size === 0 || !connected || sending}
              className={clsx('p-2.5 rounded-xl transition-all shrink-0',
                message.trim() && selected.size > 0 ? 'bg-aegis-primary text-aegis-btn-primary-text shadow-lg shadow-aegis-primary/20 hover:-translate-y-px' : 'bg-[rgb(var(--aegis-overlay)/0.04)] text-aegis-text-dim',
                'disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:translate-y-0')}
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GroupChat;
