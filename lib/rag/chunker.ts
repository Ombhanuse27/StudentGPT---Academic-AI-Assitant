// lib/rag/chunker.ts
// RAG-based PDF chunker with sentence-boundary awareness and per-page tracking

export interface TextChunk {
  content: string;
  pageNumber: number;
  chunkIndex: number;
  documentId: string;
  fileName: string;
}

/**
 * Splits a single page's text into overlapping chunks,
 * breaking at sentence boundaries when possible.
 */
export function chunkPageText(
  text: string,
  pageNumber: number,
  documentId: string,
  fileName: string,
  startIndex: number = 0,
  chunkSize: number = 900,
  overlap: number = 120
): TextChunk[] {
  const chunks: TextChunk[] = [];

  // Normalize whitespace but preserve paragraph breaks
  const clean = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  if (clean.length < 40) return chunks;

  let start = 0;
  let chunkIndex = startIndex;

  while (start < clean.length) {
    let end = start + chunkSize;

    if (end < clean.length) {
      // Try to break at the nearest sentence boundary BEFORE the hard limit
      const sentenceEnders = ['. ', '.\n', '! ', '!\n', '? ', '?\n', '\n\n'];
      let bestBreak = -1;

      for (const ender of sentenceEnders) {
        const idx = clean.lastIndexOf(ender, end);
        // Only use breaks that are in the back-half of the current chunk
        if (idx > start + chunkSize * 0.45 && idx > bestBreak) {
          bestBreak = idx + ender.length;
        }
      }

      if (bestBreak > start) {
        end = bestBreak;
      } else {
        // Fall back to word boundary
        const spaceIdx = clean.lastIndexOf(' ', end);
        if (spaceIdx > start + chunkSize * 0.5) {
          end = spaceIdx + 1;
        }
      }
    }

    const content = clean.slice(start, Math.min(end, clean.length)).trim();

    if (content.length >= 40) {
      chunks.push({
        content,
        pageNumber,
        chunkIndex: chunkIndex++,
        documentId,
        fileName,
      });
    }

    // Advance start with overlap so context isn't lost at chunk edges
    const nextStart = end - overlap;
    start = nextStart > start ? nextStart : start + 1;
  }

  return chunks;
}

/**
 * Processes a multi-page document (array of per-page strings)
 * and returns all chunks in order with global chunk indices.
 */
export function chunkDocument(
  pages: string[],
  documentId: string,
  fileName: string,
  chunkSize: number = 900,
  overlap: number = 120
): TextChunk[] {
  const allChunks: TextChunk[] = [];
  let globalIndex = 0;

  for (let i = 0; i < pages.length; i++) {
    const pageChunks = chunkPageText(
      pages[i],
      i + 1,
      documentId,
      fileName,
      globalIndex,
      chunkSize,
      overlap
    );
    allChunks.push(...pageChunks);
    globalIndex += pageChunks.length;
  }

  return allChunks;
}

/**
 * Splits a flat string (TXT / MD) into chunks the same way,
 * treating the whole file as page 1.
 */
export function chunkPlainText(
  text: string,
  documentId: string,
  fileName: string
): TextChunk[] {
  // Try to split into logical "pages" by detecting form feeds or large gaps
  const pages = text.split(/\f/).filter(p => p.trim().length > 0);
  return chunkDocument(pages.length > 1 ? pages : [text], documentId, fileName);
}