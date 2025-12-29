import {
  parseDocument,
  Document,
  isMap,
  isSeq,
  isScalar,
  isPair,
  isNode,
  isCollection,
  YAMLMap,
  YAMLSeq,
  Scalar,
  Pair,
  LineCounter
} from 'yaml';
import type {
  Node,
  ParseOptions,
  DocumentOptions,
  SchemaOptions,
  ToStringOptions
} from 'yaml';
import type {
  FrontmatterOptions,
  FrontmatterValue,
  NodeStyleInfo,
  QuoteStyle,
  ScalarType
} from './types';

/**
 * Parse YAML with full preservation options.
 * 
 * CRITICAL: 
 * - keepSourceTokens: true is essential for preventing re-formatting of complex keys like {{VALUE}}.
 * - logLevel: 'silent' completely suppresses all warnings and logs, including warnings about
 *   complex keys being stringified when parsing YAML containing {{VALUE}} syntax.
 */
export function parseYamlWithPreservation(
  content: string,
  options: Required<FrontmatterOptions>
): Document {
  const parseOptions: ParseOptions & DocumentOptions & SchemaOptions = {
    keepSourceTokens: true, // ABSOLUTELY REQUIRED for integrity
    lineCounter: new LineCounter(),
    strict: options.strictMode,
    merge: true,
    prettyErrors: true,
    version: '1.2',
    logLevel: 'silent', // Completely suppress all warnings including complex key warnings
  };

  const doc = parseDocument(content, parseOptions);

  // Check for fatal errors only
  const errors = doc.errors ?? [];
  const fatalErrors = errors.filter(
    (e: { message: string; name: string }) => !e.message.includes('warning') && e.name !== 'YAMLWarning'
  );

  if (fatalErrors.length > 0) {
    throw new Error(`YAML parse error: ${fatalErrors[0]!.message}`);
  }

  return doc;
}

/**
 * Create empty YAML document with proper structure
 */
export function createEmptyDocument(): Document {
  const doc = new Document({});
  doc.contents = new YAMLMap();
  return doc;
}

/**
 * Convert QuoteStyle to ScalarType
 */
export function toScalarType(style: QuoteStyle): ScalarType {
  switch (style) {
    case 'single': return 'QUOTE_SINGLE';
    case 'double': return 'QUOTE_DOUBLE';
    case 'literal': return 'BLOCK_LITERAL';
    case 'folded': return 'BLOCK_FOLDED';
    default: return 'PLAIN';
  }
}

/**
 * Get serialization options based on configuration
 */
export function getToStringOptions(options: Required<FrontmatterOptions>): ToStringOptions {
  return {
    indent: options.indent,
    // CRITICAL: 0 disables wrapping. Any other value risks corrupting long lines or complex structures.
    lineWidth: options.lineWidth === 0 ? 0 : options.lineWidth,
    minContentWidth: 0, // Disable minimum width enforcement
    // REMOVED: defaultStringType and defaultKeyType to prevent overriding source tokens.
    // Setting these forces 'yaml' to reformat nodes even if they haven't changed,
    // which breaks preservation of complex keys like {{VALUE}}.
    directives: false,
    nullStr: options.nullStr,
    trueStr: options.trueStr,
    falseStr: options.falseStr,
    // simpleKeys: false, // REMOVED: This forces explicit keys (? key) which breaks {{VALUE}} placeholders
    doubleQuotedMinMultiLineLength: options.multilineThreshold,
    blockQuote: true,
  };
}

/**
 * Sort map items in place
 */
export function sortMapItems(
  map: YAMLMap,
  comparator: boolean | ((a: string, b: string) => number)
): void {
  const sortFn = typeof comparator === 'function'
    ? comparator
    : (a: string, b: string) => a.localeCompare(b);

  map.items.sort((a: unknown, b: unknown) => {
    if (!isPair(a) || !isPair(b)) return 0;

    const keyA = isScalar(a.key) ? String(a.key.value) : String(a.key);
    const keyB = isScalar(b.key) ? String(b.key.value) : String(b.key);

    return sortFn(keyA, keyB);
  });
}

/**
 * Serialize document with precision
 */
export function serializeDocument(
  doc: Document,
  options: Required<FrontmatterOptions>
): string {
  const toStringOptions = getToStringOptions(options);

  // Apply options to the document instance instead of passing to toString
  // This allows 'keepSourceTokens' to work more effectively for existing nodes
  Object.assign(doc.options, toStringOptions);

  // Handle key sorting if requested
  if (options.sortKeys && isMap(doc.contents)) {
    sortMapItems(doc.contents as YAMLMap, options.sortKeys);
  }

  // Call toString without arguments to prioritize source preservation
  let result = doc.toString();

  // Ensure proper trailing newline
  if (result.length > 0 && !result.endsWith('\n')) {
    result += '\n';
  }

  return result;
}

/**
 * Extract style info from a node for preservation
 */
export function extractNodeStyle(node: Node | null | undefined): NodeStyleInfo {
  if (!node || !isNode(node)) {
    return {
      type: null,
      flow: false,
      spaceBefore: false,
      commentBefore: null,
      comment: null,
      anchor: null,
    };
  }

  const scalar = isScalar(node) ? node as Scalar : null;
  const collection = isCollection(node) ? node : null;

  return {
    type: scalar?.type as ScalarType | null ?? null,
    flow: collection ? (collection as YAMLMap | YAMLSeq).flow === true : false,
    spaceBefore: (node as { spaceBefore?: boolean }).spaceBefore ?? false,
    commentBefore: (node as { commentBefore?: string }).commentBefore ?? null,
    comment: (node as { comment?: string }).comment ?? null,
    anchor: (node as { anchor?: string }).anchor ?? null,
  };
}

/**
 * Apply style info to a node
 */
export function applyNodeStyle(node: Node, style: NodeStyleInfo): void {
  if (style.spaceBefore) {
    (node as { spaceBefore?: boolean }).spaceBefore = true;
  }
  if (style.commentBefore !== null) {
    (node as { commentBefore?: string }).commentBefore = style.commentBefore;
  }
  if (style.comment !== null) {
    (node as { comment?: string }).comment = style.comment;
  }
  if (style.anchor !== null) {
    (node as { anchor?: string }).anchor = style.anchor;
  }
  if (isScalar(node) && style.type) {
    (node as Scalar).type = style.type;
  }
  if (isCollection(node)) {
    (node as YAMLMap | YAMLSeq).flow = style.flow;
  }
}

/**
 * Find pair by key in a map
 */
export function findPairByKey(map: YAMLMap, key: string): Pair | undefined {
  for (const item of map.items) {
    if (isPair(item)) {
      const itemKey = isScalar(item.key) ? item.key.value : item.key;
      if (itemKey === key) {
        return item;
      }
    }
  }
  return undefined;
}

/**
 * Create node with appropriate style
 */
export function createStyledNode(
  doc: Document,
  value: FrontmatterValue,
  options: Required<FrontmatterOptions>,
  existingStyle: NodeStyleInfo | null = null,
  depth: number = 0
): Node {
  if (depth > options.maxDepth) {
    throw new Error(`Maximum nesting depth (${options.maxDepth}) exceeded`);
  }

  // Handle null
  if (value === null) {
    const node = doc.createNode(null) as Scalar;
    if (existingStyle) applyNodeStyle(node, existingStyle);
    return node;
  }

  // Handle primitives
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const node = doc.createNode(value) as Scalar;

    if (existingStyle && existingStyle.type && options.preserveScalarStyle) {
      node.type = existingStyle.type;
    }
    if (existingStyle) {
      applyNodeStyle(node, existingStyle);
    }

    return node;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    const seq = new YAMLSeq();
    seq.flow = options.flowStyle || (existingStyle?.flow ?? false);

    for (let i = 0; i < value.length; i++) {
      const itemNode = createStyledNode(doc, value[i], options, null, depth + 1);
      seq.items.push(itemNode);
    }

    if (existingStyle) {
      applyNodeStyle(seq, existingStyle);
    }

    return seq;
  }

  // Handle objects
  if (typeof value === 'object') {
    const map = new YAMLMap();
    map.flow = options.flowStyle || (existingStyle?.flow ?? false);

    const entries = Object.entries(value);
    for (const [k, v] of entries) {
      const keyNode = doc.createNode(k) as Scalar;
      const valueNode = createStyledNode(doc, v as FrontmatterValue, options, null, depth + 1);
      map.items.push(new Pair(keyNode, valueNode));
    }

    if (existingStyle) {
      applyNodeStyle(map, existingStyle);
    }

    return map;
  }

  return doc.createNode(null);
}

/**
 * Update node value with style preservation
 */
export function updateNodeWithPreservation(
  doc: Document,
  existingNode: Node,
  newValue: FrontmatterValue,
  options: Required<FrontmatterOptions>,
  depth: number = 0
): Node {
  if (depth > options.maxDepth) {
    throw new Error(`Maximum nesting depth (${options.maxDepth}) exceeded`);
  }

  const existingStyle = extractNodeStyle(existingNode);

  // Handle null
  if (newValue === null) {
    if (isScalar(existingNode) && existingNode.value === null) {
      return existingNode;
    }
    const node = doc.createNode(null) as Scalar;
    applyNodeStyle(node, existingStyle);
    return node;
  }

  // Handle same-type scalars - update in place
  if (isScalar(existingNode)) {
    const existingType = typeof existingNode.value;
    const newType = typeof newValue;

    if (
      (newType === 'string' || newType === 'number' || newType === 'boolean') &&
      (existingType === newType || (existingType === 'object' && existingNode.value === null))
    ) {
      existingNode.value = newValue;
      return existingNode;
    }
  }

  // Handle arrays with merge strategies
  if (Array.isArray(newValue)) {
    if (isSeq(existingNode) && options.preserveCollectionStyle) {
      const existingSeq = existingNode as YAMLSeq;
      const newSeq = new YAMLSeq();
      
      // Handle optional property assignment carefully
      if (existingSeq.flow !== undefined) {
        newSeq.flow = existingSeq.flow;
      }
      
      applyNodeStyle(newSeq, existingStyle);

      for (let i = 0; i < newValue.length; i++) {
        const itemNode = createStyledNode(doc, newValue[i], options, null, depth + 1);
        newSeq.items.push(itemNode);
      }

      return newSeq;
    }

    return createStyledNode(doc, newValue, options, existingStyle, depth);
  }

  // Handle objects with deep merge
  if (typeof newValue === 'object' && newValue !== null) {
    if (isMap(existingNode) && options.deepMerge) {
      const existingMap = existingNode as YAMLMap;
      const newEntries = Object.entries(newValue);

      for (const [key, val] of newEntries) {
        const existingPair = findPairByKey(existingMap, key);

        if (existingPair && isNode(existingPair.value)) {
          existingPair.value = updateNodeWithPreservation(
            doc,
            existingPair.value as Node,
            val as FrontmatterValue,
            options,
            depth + 1
          );
        } else if (existingPair) {
          existingPair.value = createStyledNode(doc, val as FrontmatterValue, options, null, depth + 1);
        } else {
          const keyNode = doc.createNode(key) as Scalar;
          const valueNode = createStyledNode(doc, val as FrontmatterValue, options, null, depth + 1);
          existingMap.items.push(new Pair(keyNode, valueNode));
        }
      }

      return existingMap;
    }

    return createStyledNode(doc, newValue, options, existingStyle, depth);
  }

  // Create new node for type change
  return createStyledNode(doc, newValue, options, existingStyle, depth);
}
