/**
 * Small, provider-independent sentence splitter for streaming assistant text.
 * It intentionally handles Chinese punctuation first because OpenClaw users
 * commonly mix Chinese and English in the same response.
 */
export class SentenceSplitter {
  private buffer = '';

  feed(delta: string): string[] {
    if (!delta) return [];
    this.buffer += delta;
    const sentences: string[] = [];

    while (true) {
      const end = findSentenceBoundary(this.buffer);
      if (end < 0) break;
      const sentence = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end);
      if (sentence) sentences.push(sentence);
    }

    // Avoid waiting forever on a long paragraph that has no punctuation.
    if (this.buffer.length >= 180) {
      const splitAt = findSoftBoundary(this.buffer);
      if (splitAt > 0) {
        sentences.push(this.buffer.slice(0, splitAt).trim());
        this.buffer = this.buffer.slice(splitAt);
      }
    }

    return sentences.filter(Boolean);
  }

  flush(): string | null {
    const value = this.buffer.trim();
    this.buffer = '';
    return value || null;
  }

  reset(): void {
    this.buffer = '';
  }
}

function findSentenceBoundary(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ('。！？!?'.includes(char)) {
      return index + 1;
    }
    if (char === '.') {
      const next = value[index + 1];
      // A chunk can end in the middle of a decimal/version (`v1.`). Defer a
      // terminal ASCII period until the next delta or final flush confirms it.
      if (next !== undefined && /\s/.test(next)) return index + 1;
    }
  }
  return -1;
}

function findSoftBoundary(value: string): number {
  const candidates = ['，', ',', '；', ';', '、', ' '];
  for (let index = Math.min(value.length - 1, 180); index > 40; index -= 1) {
    if (candidates.includes(value[index])) return index + 1;
  }
  return 180;
}

/** Remove content that should never be read aloud by a desktop assistant. */
export function sanitizeSpeechText(value: string): string {
  return value
    // Remove complete and currently-open control blocks. The `$` branch is
    // important for cumulative streaming deltas: do not speak a code line
    // merely because the closing fence has not arrived yet.
    .replace(/<openclaw_artifact\b[\s\S]*?(?:<\/openclaw_artifact>|$)/gi, ' ')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/MEDIA:(?:https?:\/\/|\/|[A-Z]:\\)[^\s]+/gi, ' ')
    .replace(/\[\[(?:workshop|button|reply_to):[\s\S]*?(?:\]\]|$)/gi, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    // Hold incomplete Markdown constructs until a later cumulative delta
    // supplies the closing token.
    .replace(/`[^`]*$/g, ' ')
    .replace(/!?(?:\[[^\]]*\]\([^)]*|\[[^\]]*)$/g, ' ')
    .replace(/^\s{0,3}(?:[-*+]\s+|#{1,6}\s+)/gm, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
