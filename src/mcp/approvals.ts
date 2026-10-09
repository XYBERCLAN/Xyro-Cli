// Which MCP tools may run without a prompt (from each server's "autoApprove").
// Kept separate so the permission gate can read it without importing the
// MCP manager (avoids an import cycle).

const autoApproved = new Set<string>();

export function setMcpAutoApproved(toolNames: string[]): void {
  for (const n of toolNames) autoApproved.add(n);
}

export function clearMcpAutoApproved(prefix: string): void {
  for (const n of [...autoApproved]) if (n.startsWith(prefix)) autoApproved.delete(n);
}

/** MCP tools ask before running unless the server config auto-approves them. */
export function mcpNeedsApproval(toolName: string): boolean {
  return toolName.startsWith("mcp__") && !autoApproved.has(toolName);
}
