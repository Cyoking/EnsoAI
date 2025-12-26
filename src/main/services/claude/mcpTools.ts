// MCP Tool definitions following the protocol spec
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    $schema?: string;
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

// No tools exposed - only selection_changed and at_mentioned notifications are used
export const MCP_TOOLS: McpTool[] = [];
