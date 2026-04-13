import type { ChunkConfig } from '../shared/types.js';

export function chunkText(text: string, config: ChunkConfig): string[] {
  const { maxLength, splitMode } = config;
  if (!text || text.length <= maxLength) return [text];

  switch (splitMode) {
    case 'sentence': return chunkBySentence(text, maxLength);
    case 'word': return chunkByWord(text, maxLength);
    case 'newline': return chunkByNewline(text, maxLength);
    case 'anywhere': return chunkAnywhere(text, maxLength);
    default: return chunkBySentence(text, maxLength);
  }
}

function chunkBySentence(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = -1;
    const sentenceEnders = /[.!?]\s/g;
    let match: RegExpExecArray | null;
    while ((match = sentenceEnders.exec(remaining)) !== null) {
      if (match.index + match[0].length <= maxLength) {
        splitAt = match.index + match[0].length;
      } else {
        break;
      }
    }

    if (splitAt <= 0) {
      splitAt = chunkByWordFindSplit(remaining, maxLength);
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter(Boolean);
}

function chunkByWord(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    const splitAt = chunkByWordFindSplit(remaining, maxLength);
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter(Boolean);
}

function chunkByWordFindSplit(text: string, maxLength: number): number {
  let splitAt = text.lastIndexOf(' ', maxLength);
  if (splitAt <= 0) splitAt = maxLength;
  return splitAt;
}

function chunkByNewline(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt <= 0) splitAt = chunkByWordFindSplit(remaining, maxLength);

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).replace(/^\n/, '').trimStart();
  }

  return chunks.filter(Boolean);
}

function chunkAnywhere(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.slice(i, i + maxLength));
  }
  return chunks;
}
