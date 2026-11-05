import { validateStrategy } from "../validation/strategy.ts";
import type { StrategyDefinition, StrategyNode, ValidationContext, ValidationResult } from "../validation/strategy.ts";

export type StrategyEdit =
  | { type: "addNode"; node: StrategyNode }
  | { type: "removeNode"; nodeId: string }
  | { type: "updateNode"; nodeId: string; settings: {
      period?: number; comparison?: "lt" | "gt"; threshold?: number;
      side?: "BUY" | "SELL"; notionalUsd?: number;
    } }
  | { type: "connect"; edge: StrategyDefinition["edges"][number] }
  | { type: "disconnect"; edgeId: string };

export function editStrategy(strategy: StrategyDefinition, edit: StrategyEdit): StrategyDefinition {
  const next = structuredClone(strategy);
  if (edit.type === "addNode") {
    if (next.nodes.some(node => node.id === edit.node.id)) throw new Error("Block ID already exists.");
    next.nodes.push(structuredClone(edit.node));
  } else if (edit.type === "connect") {
    if (!next.nodes.some(node => node.id === edit.edge.source) || !next.nodes.some(node => node.id === edit.edge.target)) {
      throw new Error("A connection endpoint does not exist.");
    }
    if (next.edges.some(edge => edge.id === edit.edge.id || (edge.source === edit.edge.source && edge.target === edit.edge.target))) {
      throw new Error("Connection already exists.");
    }
    next.edges.push({...edit.edge});
  } else if (edit.type === "disconnect") {
    next.edges = next.edges.filter(edge => edge.id !== edit.edgeId);
  } else {
    const node = next.nodes.find(node => node.id === edit.nodeId);
    if (!node) throw new Error("Block does not exist.");
    if (edit.type === "removeNode") {
      next.nodes = next.nodes.filter(node => node.id !== edit.nodeId);
      next.edges = next.edges.filter(edge => edge.source !== edit.nodeId && edge.target !== edit.nodeId);
    } else {
      for (const key of Object.keys(edit.settings)) {
        if (key === "id" || key === "type" || !Object.hasOwn(node, key)) throw new Error("Setting does not belong to this block.");
      }
      Object.assign(node, edit.settings);
    }
  }
  return next;
}

export function importStrategyJson(text: string, context: ValidationContext): ValidationResult {
  if (new TextEncoder().encode(text).length > 65536) {
    return {valid: false, issues: [{code: "INPUT_TOO_LARGE", path: "$", message: "Strategy JSON must be at most 64 KiB."}]};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {valid: false, issues: [{code: "INVALID_JSON", path: "$", message: "Enter a valid JSON document."}]};
  }
  return validateStrategy(parsed, context);
}

export function exportStrategyJson(strategy: StrategyDefinition, context: ValidationContext): string {
  const result = validateStrategy(strategy, context);
  if (!result.valid) throw new Error(`Invalid strategy: ${result.issues[0]?.message}`);
  return JSON.stringify(result.strategy, null, 2);
}
