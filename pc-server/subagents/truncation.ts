// subagents/truncation.ts — Output Truncation Detection
// Adopted from Agent-2 architecture (agent2/core/workflow/dynamic.py _looks_truncated)
// Prevents accepting half-written code files or cut-off model thoughts.

export interface TruncationCheckResult {
  isTruncated: boolean;
  reason?: string;
  unclosedFences?: number;
}

const DANGLING_WORD_REGEX = /\b(and|or|but|if|then|else|the|a|an|to|with|for|in|of|function|const|let|var|class|interface|type|return|import|export)\s*$/i;
const DANGLING_PUNCTUATION_REGEX = /([,:=+\-*/\\&|^~<>()\[{]|\b=>)\s*$/;

export function looksTruncated(text: string): TruncationCheckResult {
  if (!text || !text.trim()) {
    return { isTruncated: false };
  }

  const trimmed = text.trim();

  // 1. Code fence parity: count ``` occurrences
  const fenceMatches = trimmed.match(/```/g);
  const fenceCount = fenceMatches ? fenceMatches.length : 0;
  if (fenceCount % 2 !== 0) {
    return {
      isTruncated: true,
      reason: `Unclosed markdown code fence detected (${fenceCount} occurrences)`,
      unclosedFences: 1,
    };
  }

  // 2. Trailing dangling syntax / operators / open parentheses
  if (DANGLING_PUNCTUATION_REGEX.test(trimmed)) {
    return {
      isTruncated: true,
      reason: `Output ends abruptly with trailing operator/punctuation: "${trimmed.slice(-15)}"`,
    };
  }

  // 3. Trailing dangling keywords
  if (DANGLING_WORD_REGEX.test(trimmed)) {
    return {
      isTruncated: true,
      reason: `Output ends abruptly with incomplete keyword: "${trimmed.slice(-20)}"`,
    };
  }

  // 4. Broken JSON / Brackets at tail
  let openBrace = 0;
  let openBracket = 0;
  for (const ch of trimmed) {
    if (ch === "{") openBrace++;
    else if (ch === "}") openBrace = Math.max(0, openBrace - 1);
    else if (ch === "[") openBracket++;
    else if (ch === "]") openBracket = Math.max(0, openBracket - 1);
  }
  if (openBrace > 0 || openBracket > 0) {
    // If text looks like a JSON block or object that was never closed
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return {
        isTruncated: true,
        reason: `Unclosed JSON structure (${openBrace} unclosed '{', ${openBracket} unclosed '[')`,
      };
    }
  }

  return { isTruncated: false };
}
