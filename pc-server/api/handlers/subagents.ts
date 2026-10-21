// api/handlers/subagents.ts — REST API routes for SubAgents
// Ported from rikkahub-agent (Pyth0nkod3r fork)

import { id as newId } from "../../foundation/utils";
import { error, json, readJson } from "../request";
import {
  deleteSubAgentProfile,
  getSubAgentProfile,
  getSubAgentRun,
  listSubAgentProfiles,
  listSubAgentRuns,
  upsertSubAgentProfile,
} from "../../subagents/db";
import { subAgentRegistry } from "../../subagents/registry";
import { subAgentEngine } from "../../subagents/engine";
import type { SubAgentProfile, SubAgentRequest } from "../../subagents/types";

export async function handleSubAgentRoutes(
  request: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  // Profiles listing & creation
  if (path === "subagents/profiles") {
    if (request.method === "GET") {
      return json(listSubAgentProfiles());
    }
    if (request.method === "POST") {
      const body = await readJson<Partial<SubAgentProfile>>(request);
      const name = String(body.name ?? "").trim();
      if (!name) return error("name is required for subagent profile", 400);

      const now = Date.now();
      const profile: SubAgentProfile = {
        id: body.id && String(body.id).trim() ? String(body.id) : newId(),
        name,
        description: String(body.description ?? "").trim(),
        systemPrompt: String(body.systemPrompt ?? "").trim(),
        modelId: body.modelId ? String(body.modelId) : null,
        enabled: body.enabled !== false,
        tools: Array.isArray(body.tools) ? body.tools.map(String) : [],
        capabilities: Array.isArray(body.capabilities) ? body.capabilities.map(String) : [],
        createdAt: Number.isFinite(body.createdAt) ? Number(body.createdAt) : now,
        updatedAt: now,
      };

      upsertSubAgentProfile(profile);
      return json(profile);
    }
  }

  // Profile by ID
  const profileMatch = path.match(/^subagents\/profiles\/([^/]+)$/);
  if (profileMatch) {
    const profileId = decodeURIComponent(profileMatch[1]);
    if (request.method === "GET") {
      const profile = getSubAgentProfile(profileId);
      if (!profile) return error("Sub-agent profile not found", 404);
      return json(profile);
    }
    if (request.method === "DELETE") {
      const ok = deleteSubAgentProfile(profileId);
      return json({ status: "deleted", ok });
    }
  }

  // Runs listing
  if (path === "subagents/runs" && request.method === "GET") {
    const activeOnly = url.searchParams.get("active_only") === "true";
    const parentConversationId = url.searchParams.get("conversationId") || undefined;
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const runs = listSubAgentRuns({ activeOnly, parentConversationId, limit });
    return json(runs);
  }

  // Run detail & cancel
  const runMatch = path.match(/^subagents\/runs\/([^/]+)(\/cancel)?$/);
  if (runMatch) {
    const runId = decodeURIComponent(runMatch[1]);
    const isCancel = runMatch[2] === "/cancel";

    if (isCancel && request.method === "POST") {
      const ok = subAgentRegistry.requestCancel(runId);
      if (ok) {
        subAgentRegistry.update(runId, (r) => ({
          ...r,
          status: "cancelled",
          finishedAtMs: Date.now(),
        }));
      }
      return json({ status: "cancelled", ok });
    }

    if (!isCancel && request.method === "GET") {
      const run = subAgentRegistry.get(runId) ?? getSubAgentRun(runId);
      if (!run) return error("Sub-agent run not found", 404);
      return json(run);
    }
  }

  // Direct dispatch endpoint
  if (path === "subagents/dispatch" && request.method === "POST") {
    const body = await readJson<{
      parentAssistantId?: string;
      parentChatId?: string;
      request: SubAgentRequest;
    }>(request);

    if (!body?.request) {
      return error("request object is required", 400);
    }

    const res = await subAgentEngine.dispatch(
      body.parentAssistantId ?? "",
      body.parentChatId ?? null,
      body.request,
    );

    if (!res.ok) {
      return error(res.detail, 400, res.error);
    }

    return json(res.run, { status: 202 });
  }

  return null;
}
