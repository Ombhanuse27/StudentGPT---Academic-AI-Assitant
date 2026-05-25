'use client'

import { useChat, type Message } from 'ai/react'
import { useState, useCallback } from 'react'
import { ChatList } from '@/components/chat-list'
import { ChatPanel } from '@/components/chat-panel'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { EmptyScreen } from '@/components/empty-screen'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'

export interface ChatProps extends React.ComponentProps<'div'> {
  initialMessages?: Message[]
  id?: string
}

export function Chat({ id, initialMessages, className }: ChatProps) {
  // ── Document state ─────────────────────────────────────────────────────────
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [documentFileName, setDocumentFileName] = useState<string | null>(null)
  const [isRagLoading, setIsRagLoading] = useState(false)

  // ── Extra messages (RAG + upload confirmations) managed outside useChat ────
  // We keep these separate because older ai/react versions don't expose setMessages.
  const [extraMessages, setExtraMessages] = useState<Message[]>([])

  // ── Main chat (non-document mode) ─────────────────────────────────────────
  const {
    messages: chatMessages,
    append,
    reload,
    stop,
    isLoading,
    input,
    setInput,
  } = useChat({
    api: '/api/chat',
    initialMessages,
    id,
    onResponse(response: any) {
      if (response.status !== 200) {
        toast.error(response.statusText)
      }
    },
  })

  // Merge useChat messages with manually managed RAG/upload messages
  const allMessages: Message[] = [...chatMessages, ...extraMessages].sort(
    (a, b) => Number(a.id) - Number(b.id)
  )

  const addMessage = (msg: Omit<Message, 'id'>) =>
    setExtraMessages((prev) => [
      ...prev,
      { ...msg, id: Date.now().toString() } as Message,
    ])

  // ── Upload handler → RAG upload endpoint ──────────────────────────────────
  const handleDocumentUpload = useCallback(
    async (documentData: {
      documentId: string
      fileName: string
      fileContent: string
      fileType: string
    }) => {
      try {
        const response = await fetch('/api/rag/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(documentData),
        })

        const result = await response.json()

        if (!response.ok) {
          addMessage({
            role: 'assistant',
            content:
              result.message ??
              `# ⚠️ Upload Failed\n\n\`${result.error ?? 'Unknown error'}\``,
          })
          toast.error('Upload failed — see chat for details')
          return
        }

        // Persist doc info for subsequent RAG queries
        setDocumentId(documentData.documentId)
        setDocumentFileName(documentData.fileName)

        addMessage({ role: 'assistant', content: result.message })
        toast.success(`${documentData.fileName} indexed successfully!`)
      } catch (error: any) {
        console.error('Document upload error:', error)
        toast.error('Failed to upload document')
        throw error
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  /**
   * Unified submit:
   *  - Document loaded  → /api/rag/chat  (RAG mode)
   *  - No document      → useChat append → /api/chat  (normal mode)
   */
  const handleSubmit = useCallback(
    async (value: string) => {
      if (!value.trim()) return

      if (documentId && documentFileName) {
        // Optimistically show user message
        const userMsg: Message = {
          id: Date.now().toString(),
          role: 'user',
          content: value,
        }
        setExtraMessages((prev) => [...prev, userMsg])
        setIsRagLoading(true)

        // Build full history for the API (chat + extra, sorted, plus new message)
        const historyForApi = [
          ...[...chatMessages, ...extraMessages]
            .sort((a, b) => Number(a.id) - Number(b.id))
            .map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: value },
        ]

        try {
          const response = await fetch('/api/rag/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: historyForApi, documentId, documentFileName }),
          })

          const result = await response.json()

          setExtraMessages((prev) => [
            ...prev,
            {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content:
                result.message?.content ??
                '# ⚠️ No response received. Please try again.',
            } as Message,
          ])
        } catch (error: any) {
          console.error('RAG chat error:', error)
          setExtraMessages((prev) => [
            ...prev,
            {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: `# ⚠️ Error\n\n\`${error.message}\`\n\nPlease try again.`,
            } as Message,
          ])
        } finally {
          setIsRagLoading(false)
        }
      } else {
        // Normal chat — attendance / timetable / syllabus etc.
        await append({ id, content: value, role: 'user' })
      }
    },
    [documentId, documentFileName, chatMessages, extraMessages, append, id]
  )

  const combinedIsLoading = isLoading || isRagLoading

  return (
    <>
      <div className={cn('pb-[200px] pt-4 md:pt-10', className)}>
        {allMessages.length ? (
          <>
            <ChatList messages={allMessages} />
            <ChatScrollAnchor trackVisibility={combinedIsLoading} />
          </>
        ) : (
          <EmptyScreen setInput={setInput} />
        )}
      </div>

      <ChatPanel
        id={id}
        isLoading={combinedIsLoading}
        stop={stop}
        append={append}
        reload={reload}
        messages={allMessages}
        input={input}
        setInput={setInput}
        onDocumentUpload={handleDocumentUpload}
        onSubmit={handleSubmit}
      />
    </>
  )
}