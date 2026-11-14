// inference-engine/decisions-api.ts — Decisions / Evaluation API Support
// Adopted from rikkahub-agent (Pyth0nkod3r fork DecisionsAPI.kt)

import type { Model } from "../foundation/types";

export interface DecisionPredicate {
  type: "predicate";
  name: string;
  instructions: string;
}

export interface DecisionEvaluationResult {
  verdict: "pass" | "fail" | "inconclusive";
  score?: number;
  reasoning?: string;
  raw: unknown;
}

export function isDecisionModel(model: Partial<Model> | null | undefined): boolean {
  if (!model) return false;
  const idStr = String(model.id ?? model.modelId ?? "").toLowerCase();
  const typeStr = String((model as Record<string, unknown>).type ?? "").toLowerCase();
  return (
    typeStr === "decision" ||
    typeStr === "evaluation" ||
    idStr.includes("decision") ||
    idStr.includes("evaluation") ||
    idStr.includes("critic-eval")
  );
}

export function synthesizeDecisionPredicate(instructions?: string): DecisionPredicate {
  return {
    type: "predicate",
    name: "assessment",
    instructions:
      instructions?.trim() ||
      "Evaluate the supplied solution, diff, or test output against stated criteria and return a definitive pass or fail decision.",
  };
}

export function parseDecisionEvaluationResult(response: unknown): DecisionEvaluationResult {
  if (!response || typeof response !== "object") {
    return { verdict: "inconclusive", raw: response };
  }

  const obj = response as Record<string, unknown>;
  const decisionStr = String(obj.decision ?? obj.verdict ?? obj.assessment ?? "").toLowerCase().trim();
  const score = typeof obj.score === "number" ? obj.score : undefined;
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : typeof obj.detail === "string" ? obj.detail : undefined;

  let verdict: "pass" | "fail" | "inconclusive" = "inconclusive";
  if (decisionStr === "pass" || decisionStr === "true" || decisionStr === "confirmed" || (score !== undefined && score >= 0.8)) {
    verdict = "pass";
  } else if (decisionStr === "fail" || decisionStr === "false" || decisionStr === "contradicted" || (score !== undefined && score < 0.5)) {
    verdict = "fail";
  }

  return {
    verdict,
    score,
    reasoning,
    raw: response,
  };
}
