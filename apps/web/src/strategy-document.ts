import { validateStrategy } from '../../../src/features/builder/validation/strategy.ts';
import { fixtureContext } from '../../../src/features/builder/fixtures/rsi-strategy.ts';
import type { StrategyDefinition } from '../../../src/features/builder/validation/strategy.ts';
import type { Json, StrategyDocumentV1 } from '../../../src/integrations/arkiv/contracts.ts';
import { parseDocument } from '../../../src/integrations/arkiv/codec.ts';
import { fail } from '../../../src/integrations/arkiv/errors.ts';

export function validateBuilderDocument(input: unknown): StrategyDocumentV1 {
  return parseDocument(input, parsed => {
    const document = parsed as StrategyDocumentV1;
    if (document.graphSchema !== 'poros-builder/1') fail('UNSUPPORTED_SCHEMA');
    // The current editor and simulator use the trusted paper registry.
    const result = validateStrategy(document.graph, fixtureContext);
    if (!result.valid) fail('INVALID_INPUT', 'The builder rejected this strategy.');
    const graph = result.strategy;
    if (!graph.riskPolicy.paperTradingOnly || document.executionChainId !== graph.networkId ||
        document.tokenIn !== graph.tokenIn.toLowerCase() || document.tokenOut !== graph.tokenOut.toLowerCase() ||
        document.name !== graph.name || document.description !== (graph.description ?? '')) fail('INVALID_INPUT');
    return document;
  });
}

export function builderDocument(graph: StrategyDefinition): StrategyDocumentV1 {
  return validateBuilderDocument({ documentSchema: 'strategy-document/1', graphSchema: 'poros-builder/1',
    name: graph.name, description: graph.description ?? '', license: 'MIT', category: 'signal',
    executionChainId: graph.networkId, tokenIn: graph.tokenIn.toLowerCase(), tokenOut: graph.tokenOut.toLowerCase(),
    graph: graph as unknown as Json });
}
