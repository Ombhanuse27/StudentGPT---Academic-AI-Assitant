// app/api/rag/chat/route.ts
// RAG-powered chat: retrieves relevant chunks via FTS → sends to Groq LLM

import Groq from 'groq-sdk';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const maxDuration = 60;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

// ─── Retrieval ────────────────────────────────────────────────────────────────

interface Chunk {
  content: string;
  page_number: number;
  chunk_index: number;
  rank?: number;
}

/**
 * Three-tier retrieval strategy:
 *  1. PostgreSQL full-text search (ts_rank)
 *  2. Regex keyword overlap fallback
 *  3. Sequential first-N chunks (last resort)
 */
async function retrieveChunks(
  documentId: string,
  query: string,
  topK: number = 6
): Promise<Chunk[]> {
  // ── Tier 1: FTS ──────────────────────────────────────────────────────────
  const ftsResult = await pool.query<Chunk>(
    `SELECT content, page_number, chunk_index,
            ts_rank(to_tsvector('english', content),
                    plainto_tsquery('english', $2)) AS rank
     FROM document_chunks
     WHERE document_id = $1
       AND to_tsvector('english', content) @@ plainto_tsquery('english', $2)
     ORDER BY rank DESC
     LIMIT $3`,
    [documentId, query, topK]
  );

  if (ftsResult.rows.length >= 3) {
    return ftsResult.rows;
  }

  // ── Tier 2: Keyword regex ─────────────────────────────────────────────────
  const keywords = query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3)
    .slice(0, 8);

  const alreadyFetched = new Set(ftsResult.rows.map((r) => r.chunk_index));
  const combined: Chunk[] = [...ftsResult.rows];

  if (keywords.length > 0) {
    const pattern = keywords.join('|');
    try {
      const regexResult = await pool.query<Chunk>(
        `SELECT content, page_number, chunk_index
         FROM document_chunks
         WHERE document_id = $1
           AND content ~* $2
         ORDER BY chunk_index
         LIMIT $3`,
        [documentId, pattern, topK - combined.length]
      );
      for (const row of regexResult.rows) {
        if (!alreadyFetched.has(row.chunk_index)) {
          combined.push(row);
          alreadyFetched.add(row.chunk_index);
        }
      }
    } catch {
      // Regex can fail on special chars; silently skip
    }
  }

  if (combined.length >= 3) return combined;

  // ── Tier 3: Sequential fallback ───────────────────────────────────────────
  const fallback = await pool.query<Chunk>(
    `SELECT content, page_number, chunk_index
     FROM document_chunks
     WHERE document_id = $1
     ORDER BY chunk_index
     LIMIT $2`,
    [documentId, topK]
  );
  for (const row of fallback.rows) {
    if (!alreadyFetched.has(row.chunk_index)) {
      combined.push(row);
    }
  }

  return combined.slice(0, topK);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { messages, documentId, documentFileName } = await req.json();

    if (!documentId) {
      return Response.json(
        {
          message: {
            role: 'assistant',
            content:
              '# ❌ No Document Loaded\n\nPlease upload a document first before asking questions.',
          },
        },
        { status: 400 }
      );
    }

    const userQuery: string = messages[messages.length - 1]?.content ?? '';

    // ── Retrieve relevant chunks ──────────────────────────────────────────────
    const chunks = await retrieveChunks(documentId, userQuery);

    if (chunks.length === 0) {
      return Response.json({
        message: {
          role: 'assistant',
          content: `# ❌ No Content Found\n\nCouldn't find relevant information in **${documentFileName}** for your question.\n\n**Suggestions:**\n- Rephrase using keywords from the document\n- Ask a more specific question\n- Try "Summarize the document" to see what's available`,
        },
      });
    }

    // Sort retrieved chunks by page then chunk order for coherent reading
    chunks.sort((a, b) => a.page_number - b.page_number || a.chunk_index - b.chunk_index);

    // Format context with page citations
    const context = chunks
      .map((c) => `[📄 Page ${c.page_number}]\n${c.content}`)
      .join('\n\n' + '─'.repeat(60) + '\n\n');

    const pagesCited = [...new Set(chunks.map((c) => c.page_number))].sort(
      (a, b) => a - b
    );

    // ── System prompt ─────────────────────────────────────────────────────────
    const systemPrompt = `You are DYPCET AI Assistant, analyzing an uploaded document for a student.

DOCUMENT: "${documentFileName}"
PAGES RETRIEVED: ${pagesCited.join(', ')}

STRICT RULES:
1. Answer ONLY using the provided document excerpts below — never use external knowledge.
2. Always cite which page(s) you are drawing from (e.g., "According to Page 3…").
3. If the answer spans multiple pages, mention each relevant page.
4. If the information is NOT in the provided excerpts, explicitly say:
   "This information was not found in the retrieved sections. Try rephrasing your question."
5. Format your answer in clear Markdown with headings, bullet points, or tables as appropriate.
6. Be thorough but concise. Avoid padding.

──────────── RETRIEVED DOCUMENT EXCERPTS ────────────
${context}
─────────────────────────────────────────────────────`;

    // Keep only the last 8 conversation turns to stay within token limits
    const conversationHistory = messages.slice(-8).map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // ── LLM call ─────────────────────────────────────────────────────────────
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
      ],
    });

    const answer = completion.choices[0].message.content ?? '';

    // Append a compact source footer
    const sourceFooter = `\n\n---\n📑 **Sources:** Pages ${pagesCited.join(', ')} of *${documentFileName}*`;

    return Response.json({
      message: {
        role: 'assistant',
        content: answer + sourceFooter,
      },
    });
  } catch (error: any) {
    console.error('RAG chat error:', error);

    // Rate limit pass-through
    if (error.status === 429) {
      return Response.json({
        message: {
          role: 'assistant',
          content: `# ⏳ Rate Limit Reached\n\nThe AI service is temporarily overloaded. Please wait a moment and try again.\n\n\`${error.message}\``,
        },
      });
    }

    return Response.json(
      {
        message: {
          role: 'assistant',
          content: `# ⚠️ Error\n\n\`${error.message}\`\n\nPlease try again.`,
        },
      },
      { status: 500 }
    );
  }
}