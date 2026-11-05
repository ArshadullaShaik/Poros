// shortcut: provisional Dev 3 contract, replace with Dev 4's canonical imports when agreed.
export type Address = `0x${string}`;

export type StrategyNode =
  | { id: string; type: "indicator.rsi"; period: number; comparison: "lt" | "gt"; threshold: number }
  | { id: string; type: "guard.risk" }
  | { id: string; type: "action.intent"; side: "BUY" | "SELL"; notionalUsd: number };

export type StrategyDefinition = {
  schemaVersion: "1";
  strategyId: string;
  parentVersionId?: string;
  name: string;
  description?: string;
  creatorWallet?: Address;
  networkId: number;
  tokenIn: Address;
  tokenOut: Address;
  nodes: StrategyNode[];
  edges: { id: string; source: string; target: string }[];
  riskPolicy: {
    maxNotionalUsd: number;
    maxSlippageBps: number;
    allowlistedTokenAddresses: Address[];
    paperTradingOnly: boolean;
  };
  metadata?: { tags?: string[]; createdAt?: string };
};

export type ValidationIssue = { code: string; path: string; message: string; nodeId?: string };
export type ValidationResult =
  | { valid: true; strategy: StrategyDefinition }
  | { valid: false; issues: ValidationIssue[] };

export type ValidationContext = { networkId: number; tokenAddresses: readonly Address[] };

export function validateStrategy(input: unknown, context: ValidationContext): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (code: string, path: string, message: string, nodeId?: string) => {
    issues.push({ code, path, message, ...(nodeId ? { nodeId } : {}) });
  };
  const object = (value: unknown, path: string, required: string[], optional: string[] = []) => {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      add("INVALID_OBJECT", path, "Expected a plain JSON object.");
      return undefined;
    }
    const record = value as Record<string, unknown>;
    for (const key of required) {
      if (!Object.hasOwn(record, key)) add("MISSING_FIELD", `${path}.${key}`, "Required field is missing.");
    }
    for (const key of Object.keys(record)) {
      if (!required.includes(key) && !optional.includes(key)) {
        add("UNKNOWN_FIELD", `${path}.${key}`, "Field is not supported.");
      }
    }
    return record;
  };
  const text = (value: unknown, path: string, max = 128) => {
    if (typeof value !== "string" || !value.trim() || value.length > max) {
      add("INVALID_STRING", path, `Expected nonblank text of at most ${max} characters.`);
    }
  };
  const number = (value: unknown, path: string, min: number, max: number, integer = false) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max ||
        (integer && !Number.isSafeInteger(value))) {
      add("INVALID_NUMBER", path, `Expected a finite ${integer ? "integer" : "number"} from ${min} to ${max}.`);
    }
  };
  const address = (value: unknown, path: string) => {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      add("INVALID_ADDRESS", path, "Expected a 20-byte hexadecimal address.");
    }
  };
  const array = (value: unknown, path: string, min: number, max: number) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) {
      add("INVALID_ARRAY", path, `Expected an array with ${min} to ${max} entries.`);
      return undefined;
    }
    return value as unknown[];
  };

  const registry = object(context, "$context", ["networkId", "tokenAddresses"]);
  if (!registry) return { valid: false, issues };
  number(registry.networkId, "$context.networkId", 1, Number.MAX_SAFE_INTEGER, true);
  const tokens = array(registry.tokenAddresses, "$context.tokenAddresses", 2, 1000);
  if (tokens) {
    for (let i = 0; i < tokens.length; i++) address(tokens[i], `$context.tokenAddresses[${i}]`);
  }
  if (issues.length) return { valid: false, issues };
  const supported = new Set((tokens as string[]).map(token => token.toLowerCase()));

  const draft = object(input, "$", [
    "schemaVersion", "strategyId", "name", "networkId", "tokenIn", "tokenOut", "nodes", "edges", "riskPolicy",
  ], ["parentVersionId", "description", "creatorWallet", "metadata"]);
  if (!draft) return { valid: false, issues };
  if (draft.schemaVersion !== "1") add("UNSUPPORTED_VERSION", "$.schemaVersion", "Only schema version 1 is supported.");
  text(draft.strategyId, "$.strategyId");
  text(draft.name, "$.name", 100);
  if (Object.hasOwn(draft, "parentVersionId")) text(draft.parentVersionId, "$.parentVersionId");
  if (Object.hasOwn(draft, "description")) text(draft.description, "$.description", 2000);
  if (Object.hasOwn(draft, "creatorWallet")) address(draft.creatorWallet, "$.creatorWallet");
  number(draft.networkId, "$.networkId", 1, Number.MAX_SAFE_INTEGER, true);
  if (draft.networkId !== registry.networkId) add("UNSUPPORTED_NETWORK", "$.networkId", "Network is not the configured trading network.");
  for (const key of ["tokenIn", "tokenOut"]) {
    address(draft[key], `$.${key}`);
    if (typeof draft[key] === "string" && !supported.has(draft[key].toLowerCase())) {
      add("UNSUPPORTED_TOKEN", `$.${key}`, "Token is not in the trusted network registry.");
    }
  }
  if (typeof draft.tokenIn === "string" && typeof draft.tokenOut === "string" &&
      draft.tokenIn.toLowerCase() === draft.tokenOut.toLowerCase()) {
    add("INVALID_PAIR", "$.tokenOut", "Base and quote tokens must be different.");
  }

  const policy = object(draft.riskPolicy, "$.riskPolicy", [
    "maxNotionalUsd", "maxSlippageBps", "allowlistedTokenAddresses", "paperTradingOnly",
  ]);
  if (policy) {
    number(policy.maxNotionalUsd, "$.riskPolicy.maxNotionalUsd", Number.MIN_VALUE, Number.MAX_SAFE_INTEGER);
    number(policy.maxSlippageBps, "$.riskPolicy.maxSlippageBps", 0, 500, true);
    if (typeof policy.paperTradingOnly !== "boolean") add("INVALID_BOOLEAN", "$.riskPolicy.paperTradingOnly", "Expected a boolean.");
    const allowed = array(policy.allowlistedTokenAddresses, "$.riskPolicy.allowlistedTokenAddresses", 2, 1000);
    if (allowed) {
      const seen = new Set<string>();
      for (let i = 0; i < allowed.length; i++) {
        const path = `$.riskPolicy.allowlistedTokenAddresses[${i}]`;
        const token = allowed[i];
        address(token, path);
        if (typeof token !== "string") continue;
        const normalized = token.toLowerCase();
        if (!supported.has(normalized)) add("UNSUPPORTED_TOKEN", path, "Allowlisted token is not in the trusted network registry.");
        if (seen.has(normalized)) add("DUPLICATE_TOKEN", path, "Allowlisted tokens must be unique.");
        seen.add(normalized);
      }
      if ([draft.tokenIn, draft.tokenOut].some(token => typeof token !== "string" || !seen.has(token.toLowerCase()))) {
        add("TOKEN_NOT_ALLOWED", "$.riskPolicy.allowlistedTokenAddresses", "Both pair tokens must be allowlisted.");
      }
    }
  }

  if (Object.hasOwn(draft, "metadata")) {
    const metadata = object(draft.metadata, "$.metadata", [], ["tags", "createdAt"]);
    if (metadata) {
      if (Object.hasOwn(metadata, "tags")) {
        const tags = array(metadata.tags, "$.metadata.tags", 0, 10);
        if (tags) for (let i = 0; i < tags.length; i++) text(tags[i], `$.metadata.tags[${i}]`, 32);
      }
      if (Object.hasOwn(metadata, "createdAt")) {
        const date = metadata.createdAt;
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(date) ||
            !Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date.replace(/(?<=:\d{2})Z$/, ".000Z")) {
          add("INVALID_DATE", "$.metadata.createdAt", "Expected a real UTC date in YYYY-MM-DDTHH:mm:ss[.sss]Z format.");
        }
      }
    }
  }

  const nodes = array(draft.nodes, "$.nodes", 1, 32);
  const edges = array(draft.edges, "$.edges", 0, 64);
  if (nodes) for (let i = 0; i < nodes.length; i++) {
    const path = `$.nodes[${i}]`;
    const raw = nodes[i];
    const kind = raw && typeof raw === "object" && "type" in raw ? raw.type : undefined;
    const fields = kind === "indicator.rsi" ? ["period", "comparison", "threshold"] :
      kind === "action.intent" ? ["side", "notionalUsd"] : [];
    const node = object(raw, path, ["id", "type", ...fields]);
    if (!node) continue;
    text(node.id, `${path}.id`);
    if (node.type === "indicator.rsi") {
      number(node.period, `${path}.period`, 2, 200, true);
      number(node.threshold, `${path}.threshold`, 0, 100);
      if (node.comparison !== "lt" && node.comparison !== "gt") add("INVALID_COMPARISON", `${path}.comparison`, "Use lt or gt.");
    } else if (node.type === "action.intent") {
      if (node.side !== "BUY" && node.side !== "SELL") add("INVALID_SIDE", `${path}.side`, "Use BUY or SELL.");
      number(node.notionalUsd, `${path}.notionalUsd`, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER);
      if (typeof node.notionalUsd === "number" && policy && typeof policy.maxNotionalUsd === "number" && node.notionalUsd > policy.maxNotionalUsd) {
        add("RISK_CAP_EXCEEDED", `${path}.notionalUsd`, "Order exceeds the policy cap.", typeof node.id === "string" ? node.id : undefined);
      }
    } else if (node.type !== "guard.risk") {
      add("UNKNOWN_NODE_TYPE", `${path}.type`, "Only RSI, risk guard and action blocks are supported.");
    }
  }
  if (edges) for (let i = 0; i < edges.length; i++) {
    const path = `$.edges[${i}]`;
    const edge = object(edges[i], path, ["id", "source", "target"]);
    if (edge) for (const key of ["id", "source", "target"]) text(edge[key], `${path}.${key}`);
  }
  if (issues.length) return { valid: false, issues };

  const strategy = input as StrategyDefinition;
  const byId = new Map<string, StrategyNode>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  strategy.nodes.forEach((node, i) => {
    if (byId.has(node.id)) add("DUPLICATE_NODE_ID", `$.nodes[${i}].id`, "Node IDs must be unique.", node.id);
    byId.set(node.id, node);
    incoming.set(node.id, 0);
    outgoing.set(node.id, 0);
  });
  const edgeIds = new Set<string>();
  const connections = new Set<string>();
  strategy.edges.forEach((edge, i) => {
    const path = `$.edges[${i}]`;
    if (edgeIds.has(edge.id)) add("DUPLICATE_EDGE_ID", `${path}.id`, "Edge IDs must be unique.");
    edgeIds.add(edge.id);
    const connection = JSON.stringify([edge.source, edge.target]);
    if (connections.has(connection)) add("DUPLICATE_CONNECTION", path, "This connection already exists.");
    connections.add(connection);
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source) add("MISSING_NODE", `${path}.source`, "Source node does not exist.");
    if (!target) add("MISSING_NODE", `${path}.target`, "Target node does not exist.");
    if (!source || !target) return;
    const permitted = (source.type === "indicator.rsi" && target.type === "guard.risk") ||
      (source.type === "guard.risk" && target.type === "action.intent");
    if (!permitted) add("INVALID_CONNECTION", path, "Connect RSI to risk guard, then risk guard to action.", target.id);
    incoming.set(target.id, incoming.get(target.id)! + 1);
    outgoing.set(source.id, outgoing.get(source.id)! + 1);
  });
  strategy.nodes.forEach((node, i) => {
    const expectedIn = node.type === "indicator.rsi" ? 0 : 1;
    const expectedOut = node.type === "action.intent" ? 0 : 1;
    if (incoming.get(node.id) !== expectedIn || outgoing.get(node.id) !== expectedOut) {
      add("INVALID_EXECUTION_PATH", `$.nodes[${i}]`, "Each action requires one complete RSI → risk guard → action path, without branching.", node.id);
    }
  });
  return issues.length ? { valid: false, issues } : { valid: true, strategy };
}
