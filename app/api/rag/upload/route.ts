// app/api/rag/upload/route.ts
// Handles document upload: PDF text extraction → chunking → PostgreSQL storage

import { Pool } from 'pg';
import { extractText } from 'unpdf';
import { chunkDocument, chunkPlainText } from '@/lib/rag/chunker';

export const runtime = 'nodejs';
export const maxDuration = 60;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

// ─── Bootstrap DB table once ──────────────────────────────────────────────────
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS document_chunks (
      id           SERIAL PRIMARY KEY,
      document_id  TEXT    NOT NULL,
      file_name    TEXT    NOT NULL,
      chunk_index  INTEGER NOT NULL,
      page_number  INTEGER NOT NULL,
      content      TEXT    NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    -- Index for fast document lookups
    CREATE INDEX IF NOT EXISTS idx_dchunks_doc_id
      ON document_chunks (document_id);

    -- GIN index for PostgreSQL full-text search
    CREATE INDEX IF NOT EXISTS idx_dchunks_fts
      ON document_chunks USING gin(to_tsvector('english', content));
  `);
}

// ─── Batch-insert helper ──────────────────────────────────────────────────────
async function insertChunks(chunks: any[]) {
  // Insert in batches of 50 to stay well within pg limits
  const BATCH = 50;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const values: any[] = [];
    const placeholders = slice
      .map((c, idx) => {
        const base = idx * 5;
        values.push(c.documentId, c.fileName, c.chunkIndex, c.pageNumber, c.content);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      })
      .join(', ');

    await pool.query(
      `INSERT INTO document_chunks (document_id, file_name, chunk_index, page_number, content)
       VALUES ${placeholders}`,
      values
    );
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const { documentId, fileName, fileContent, fileType } = await req.json();

    if (!documentId || !fileName || !fileContent || !fileType) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    await ensureTable();

    // Remove any previous chunks for this document (re-upload scenario)
    await pool.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId]);

    let chunks: any[] = [];

    // ── PDF ──────────────────────────────────────────────────────────────────
    if (fileType === 'application/pdf') {
      const buffer = new Uint8Array(Buffer.from(fileContent, 'base64'));

      // Extract text page-by-page for accurate page-number tracking
      let pages: string[];
      try {
        const result = await extractText(buffer, { mergePages: false });
        // unpdf returns string[] when mergePages=false
        pages = Array.isArray(result.text) ? result.text : [result.text as unknown as string];
      } catch {
        // Fallback: merge then treat as one page
        const fallback = await extractText(buffer, { mergePages: true });
        pages = [fallback.text];
      }

      const wordCount = pages.join(' ').split(/\s+/).filter(Boolean).length;
      if (wordCount < 10) {
        return Response.json(
          {
            error: 'image_based_pdf',
            message: `# ⚠️ Image-Based PDF Detected\n\n**File:** ${fileName}\n\nThis appears to be a **scanned or image-based PDF** (only ${wordCount} words extracted). Our system can only extract text from text-based PDFs.\n\n## ✅ Solutions:\n1. Use an OCR tool (Adobe Acrobat, ilovepdf.com) to convert it to text first\n2. Copy-paste the text into a **.txt file** and upload that\n\n**Sorry for the inconvenience!** 📄`,
          },
          { status: 422 }
        );
      }

      chunks = chunkDocument(pages, documentId, fileName);

    // ── Plain text / Markdown ─────────────────────────────────────────────────
    } else if (fileType === 'text/plain' || fileType === 'text/markdown') {
      const text = Buffer.from(fileContent, 'base64').toString('utf-8');
      if (!text.trim()) {
        return Response.json({ error: 'empty_document' }, { status: 422 });
      }
      chunks = chunkPlainText(text, documentId, fileName);

    } else {
      return Response.json(
        { error: `Unsupported file type: ${fileType}. Use PDF, TXT, or MD.` },
        { status: 415 }
      );
    }

    if (chunks.length === 0) {
      return Response.json(
        { error: 'No extractable content found in document.' },
        { status: 422 }
      );
    }

    await insertChunks(chunks);

    const totalWords = chunks.reduce(
      (sum, c) => sum + c.content.split(/\s+/).length,
      0
    );
    const pageCount = Math.max(...chunks.map((c) => c.pageNumber));

    const successMessage = `# ✅ Document Uploaded & Indexed!

## 📄 File Details:
| Property | Value |
|----------|-------|
| **📁 File Name** | ${fileName} |
| **📄 Pages** | ${pageCount} |
| **🧩 Chunks Indexed** | ${chunks.length} |
| **📝 Words** | ${totalWords.toLocaleString()} |
| **🆔 Document ID** | \`${documentId}\` |

---

## 🚀 RAG Search Active!
Your document is now **fully indexed** for semantic search. I can answer questions from **any page** accurately.

**Try asking:**
- *"Summarize this document"*
- *"What does page 3 say about [topic]?"*
- *"Find all mentions of [keyword]"*
- *"What are the key conclusions?"*

**I'm ready! Ask anything about your document. 🎯**`;

    return Response.json({
      success: true,
      documentId,
      fileName,
      message: successMessage,
      stats: {
        chunks: chunks.length,
        pages: pageCount,
        words: totalWords,
      },
    });
  } catch (error: any) {
    console.error('RAG upload error:', error);
    return Response.json(
      {
        error: error.message,
        message: `# ⚠️ Upload Error\n\n\`${error.message}\`\n\nPlease try again or contact support.`,
      },
      { status: 500 }
    );
  }
}