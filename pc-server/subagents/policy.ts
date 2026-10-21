// subagents/policy.ts — Sub-Agent Tool Policy and Capability Gate
// Ported from rikkahub-agent (Pyth0nkod3r fork) SubAgentToolPolicy.kt

import { isWorkspaceToolName } from "../workspace/approval";

export interface CapabilityDef {
  wire: string;
  toolNames: string[];
}

export const SUBAGENT_CAPABILITIES: Record<string, CapabilityDef> = {
  memory: {
    wire: "memory",
    toolNames: ["save_memory", "get_memory"],
  },
  schedule: {
    wire: "schedule",
    toolNames: [
      "schedule_job",
      "list_jobs",
      "delete_job",
      "pause_job",
      "resume_job",
      "workflow_create",
      "workflow_list",
      "workflow_get",
      "workflow_update",
      "workflow_delete",
      "workflow_run",
    ],
  },
  browser: {
    wire: "browser",
    toolNames: [
      "browser_open",
      "browser_click",
      "browser_type",
      "browser_screenshot",
      "browser_get_dom",
      "browser_close",
    ],
  },
  ssh: {
    wire: "ssh",
    toolNames: [
      "ssh_exec",
      "save_ssh_host",
      "list_ssh_hosts",
      "delete_ssh_host",
      "ssh_upload",
      "ssh_download",
    ],
  },
  subagent: {
    wire: "subagent",
    toolNames: ["subagent_dispatch", "subagent_list", "subagent_get", "subagent_cancel"],
  },
  keystore: {
    wire: "keystore",
    toolNames: [
      "keystore_generate_key",
      "keystore_sign",
      "keystore_verify",
      "keystore_encrypt",
      "keystore_decrypt",
      "keystore_delete_key",
      "keystore_list_keys",
    ],
  },
  web: {
    wire: "web",
    toolNames: ["search_web", "scrape_web"],
  },
};

export class SubAgentToolPolicy {
  private allowedNames: Set<string>;

  constructor(allowedNames: Iterable<string>) {
    this.allowedNames = new Set(allowedNames);
  }

  allows(toolName: string): boolean {
    if (isWorkspaceToolName(toolName)) return true;
    return this.allowedNames.has(toolName);
  }

  getAllowedNames(): string[] {
    return Array.from(this.allowedNames);
  }
}

export type SubAgentPolicyBuildResult =
  | { ok: true; policy: SubAgentToolPolicy }
  | { ok: false; unknownCapabilities: string[] };

/**
 * Default system prompt for an isolated sub-agent run.
 * Ported from rikkahub-agent DEFAULT_SUBAGENT_SYSTEM_PROMPT (commit 692439cef)
 */
export const DEFAULT_SUBAGENT_SYSTEM_PROMPT = `You are a focused sub-agent executing a delegated task.
You operate in an isolated environment with a restricted tool catalog (workspace tools and explicitly granted capabilities only).
Focus solely on completing the assigned task and report your findings clearly and concisely.`;

export function buildSubAgentToolPolicy(
  roleTools: Iterable<string>,
  capabilities: Iterable<string>,
): SubAgentPolicyBuildResult {
  const requestedCaps = Array.from(capabilities)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);

  const unknown = requestedCaps.filter((cap) => !SUBAGENT_CAPABILITIES[cap]);
  if (unknown.length > 0) {
    return { ok: false, unknownCapabilities: unknown };
  }

  const names = new Set<string>();
  for (const t of roleTools) {
    const trimmed = t.trim();
    if (trimmed) names.add(trimmed);
  }

  for (const cap of requestedCaps) {
    const def = SUBAGENT_CAPABILITIES[cap];
    if (def) {
      for (const t of def.toolNames) {
        names.add(t);
      }
    }
  }

  return { ok: true, policy: new SubAgentToolPolicy(names) };
}

/**
 * Process-scoped registry mapping a sub-agent conversation ID to its SubAgentToolPolicy.
 */
class SubAgentToolPoliciesRegistry {
  private policies = new Map<string, SubAgentToolPolicy>();

  register(conversationId: string, policy: SubAgentToolPolicy): void {
    this.policies.set(conversationId, policy);
  }

  unregister(conversationId: string): void {
    this.policies.delete(conversationId);
  }

  isSubAgent(conversationId: string | null | undefined): boolean {
    if (!conversationId) return false;
    return this.policies.has(conversationId);
  }

  getPolicy(conversationId: string | null | undefined): SubAgentToolPolicy | undefined {
    if (!conversationId) return undefined;
    return this.policies.get(conversationId);
  }

  permits(conversationId: string | null | undefined, toolName: string): boolean {
    if (!conversationId) return true;
    const policy = this.policies.get(conversationId);
    if (!policy) return true;
    return policy.allows(toolName);
  }

  filter<T>(
    conversationId: string | null | undefined,
    items: T[],
    nameOf: (item: T) => string,
  ): T[] {
    if (!conversationId || !this.policies.has(conversationId)) return items;
    return items.filter((item) => this.permits(conversationId, nameOf(item)));
  }
}

export const SubAgentToolPolicies = new SubAgentToolPoliciesRegistry();
