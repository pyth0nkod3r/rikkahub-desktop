// tools/skill-selector.ts — 5-tier automatic skill selector (adopted from Agent-2)
// Tiers (highest to lowest):
// 1. request       — explicitly requested in user prompt (/skill-name, @skill, use_skill)
// 2. project_doc   — mentioned in AGENTS.md / project instructions
// 3. enabled       — explicitly enabled on the assistant/conversation
// 4. auto_relevant — high lexical relevance to the current user prompt
// 5. general       — remaining available skills

import type { SkillMetadata } from "../foundation/types";

export type SkillSelectionTier =
  | "request"
  | "project_doc"
  | "enabled"
  | "auto_relevant"
  | "general";

export interface SelectedSkillEntry {
  skill: SkillMetadata;
  tier: SkillSelectionTier;
  score: number;
  reason: string;
}

const TIER_BASE_SCORE: Record<SkillSelectionTier, number> = {
  request: 500,
  project_doc: 400,
  enabled: 300,
  auto_relevant: 200,
  general: 100,
};

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "you",
  "are", "was", "were", "have", "has", "had", "not", "but", "can", "will",
  "use", "using", "help", "please", "want", "need", "make", "how", "what",
  "when", "where", "why", "all", "any", "some", "file", "code", "task",
]);

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? [];
  const unique = new Set<string>();
  for (const token of matches) {
    if (!STOP_WORDS.has(token)) unique.add(token);
  }
  return Array.from(unique);
}

/**
 * Extracts explicitly referenced skill names from user text (/name, @name, or "use skill name").
 */
export function extractExplicitSkillRequests(prompt: string, availableNames: string[]): string[] {
  if (!prompt.trim() || availableNames.length === 0) return [];
  const lowerToCanonical = new Map(availableNames.map((n) => [n.toLowerCase(), n]));
  const found = new Set<string>();

  const slashOrAtRe = /(?:^|[\s(`"'\[])(?:\/|@)([a-z0-9_-]{2,64})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = slashOrAtRe.exec(prompt)) !== null) {
    const canonical = lowerToCanonical.get(match[1].toLowerCase());
    if (canonical) found.add(canonical);
  }

  const phraseRe = /\b(?:use|invoke|activate|run)\s+(?:the\s+)?skill\s+["'`]?([a-z0-9_-]{2,64})["'`]?/gi;
  while ((match = phraseRe.exec(prompt)) !== null) {
    const canonical = lowerToCanonical.get(match[1].toLowerCase());
    if (canonical) found.add(canonical);
  }

  const normalizedPrompt = prompt.toLowerCase();
  for (const [lower, canonical] of lowerToCanonical.entries()) {
    if (lower.includes("-") && normalizedPrompt.includes(lower)) {
      found.add(canonical);
    }
  }

  return Array.from(found);
}

function scorePromptRelevance(skill: SkillMetadata, promptLower: string, promptTokens: string[]): number {
  if (!promptLower || promptTokens.length === 0) return 0;
  let score = 0;
  const skillNameLower = skill.name.toLowerCase();
  const descLower = (skill.description || "").toLowerCase();
  const nameTokens = tokenize(skillNameLower.replace(/[-_]/g, " "));
  const descTokens = new Set(tokenize(descLower));

  if (promptLower.includes(skillNameLower)) {
    score += 30;
  }

  for (const token of promptTokens) {
    if (nameTokens.includes(token)) {
      score += 18;
    } else if (descTokens.has(token)) {
      score += 10;
    } else if (descLower.includes(token) && token.length >= 4) {
      score += 5;
    }
  }

  return score;
}

export function selectSkillsForTurn(options: {
  skills: SkillMetadata[];
  userPrompt?: string;
  enabledNames?: Iterable<string>;
  projectDocText?: string;
  maxAutoRelevant?: number;
  minAutoScore?: number;
  includeGeneral?: boolean;
}): SelectedSkillEntry[] {
  const {
    skills,
    userPrompt = "",
    enabledNames = [],
    projectDocText = "",
    maxAutoRelevant = 3,
    minAutoScore = 18,
    includeGeneral = false,
  } = options;

  if (!skills || skills.length === 0) return [];

  const availableNames = skills.map((s) => s.name);
  const requestedSet = new Set(
    extractExplicitSkillRequests(userPrompt, availableNames).map((n) => n.toLowerCase()),
  );
  const projectDocSet = new Set(
    extractExplicitSkillRequests(projectDocText, availableNames).map((n) => n.toLowerCase()),
  );
  const enabledSet = new Set(Array.from(enabledNames).map((n) => n.trim().toLowerCase()).filter(Boolean));

  const promptLower = userPrompt.trim().toLowerCase();
  const promptTokens = tokenize(promptLower);

  const selected: SelectedSkillEntry[] = [];
  const autoCandidates: SelectedSkillEntry[] = [];
  const generalEntries: SelectedSkillEntry[] = [];

  for (const skill of skills) {
    const key = skill.name.toLowerCase();
    const relevance = scorePromptRelevance(skill, promptLower, promptTokens);

    if (requestedSet.has(key)) {
      selected.push({
        skill,
        tier: "request",
        score: TIER_BASE_SCORE.request + relevance,
        reason: "Explicitly requested in user prompt",
      });
      continue;
    }

    if (projectDocSet.has(key)) {
      selected.push({
        skill,
        tier: "project_doc",
        score: TIER_BASE_SCORE.project_doc + relevance,
        reason: "Referenced in project AGENTS.md",
      });
      continue;
    }

    if (enabledSet.has(key)) {
      selected.push({
        skill,
        tier: "enabled",
        score: TIER_BASE_SCORE.enabled + relevance,
        reason: "Enabled on assistant profile",
      });
      continue;
    }

    if (relevance >= minAutoScore) {
      autoCandidates.push({
        skill,
        tier: "auto_relevant",
        score: TIER_BASE_SCORE.auto_relevant + relevance,
        reason: `Auto-selected by prompt relevance (score ${relevance})`,
      });
      continue;
    }

    if (includeGeneral) {
      generalEntries.push({
        skill,
        tier: "general",
        score: TIER_BASE_SCORE.general + relevance,
        reason: "Available general skill",
      });
    }
  }

  autoCandidates.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
  const pickedAuto = autoCandidates.slice(0, Math.max(0, maxAutoRelevant));

  const combined = [...selected, ...pickedAuto, ...generalEntries];
  combined.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
  return combined;
}
