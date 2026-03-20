import { splitPathname } from "./path-utils.ts";
import type {
  BuildResult,
  MatchedEntry,
  PathMatch,
  RouteMatcher,
  RouteNode,
  SegmentToken,
} from "./types.ts";

/**
 * Matcher design:
 * - only path matching lives here
 * - request method filtering and entry dispatch stay in the caller
 * - matching is performed against precomputed candidates sorted by specificity
 *
 * @example
 * ```ts
 * const result = build(["server/routes/users/[id].ts"], {
 *   profile: "file-based",
 *   root: "server/routes",
 *   defineEntry() {
 *     return { kind: "endpoint" };
 *   },
 * });
 *
 * const matchPath = createMatcher(result);
 * const match = matchPath("/users/42");
 *
 * match?.params.id;
 * // "42"
 * ```
 */
export function createMatcher<TMeta = unknown, TEntryKind extends string = string>(
  result: BuildResult<TMeta, TEntryKind>,
): RouteMatcher<TMeta, TEntryKind> {
  const routableNodeIds = new Set(result.pathIndex.values());
  const candidates: Array<{
    leaf: RouteNode<TMeta, TEntryKind>;
    nodes: RouteNode<TMeta, TEntryKind>[];
    visibleSegments: SegmentToken[];
  }> = [];

  for (const root of result.tree.nodes) {
    collectCandidates(root, []);
  }

  // Prefer more specific paths first: static > dynamic > catchall.
  candidates.sort((left, right) => compareSpecificity(left.visibleSegments, right.visibleSegments));

  // The returned matcher is intentionally tiny: path in, matched branch out.
  return function matchPath(path: string): PathMatch<TMeta, TEntryKind> | null {
    const inputSegments = splitPathname(path);

    for (const candidate of candidates) {
      const params = matchSegments(candidate.visibleSegments, inputSegments);
      if (!params) {
        continue;
      }

      return {
        params,
        nodes: candidate.nodes,
        leaf: candidate.leaf,
        entries: collectMatchedEntries(candidate.nodes),
      };
    }

    return null;
  };

  function collectCandidates(
    node: RouteNode<TMeta, TEntryKind>,
    ancestry: RouteNode<TMeta, TEntryKind>[],
  ): void {
    const nodes = [...ancestry, node];
    if (routableNodeIds.has(node.id)) {
      candidates.push({
        leaf: node,
        nodes,
        visibleSegments: node.segments.filter((segment) => segment.type !== "group"),
      });
    }

    for (const child of node.children) {
      collectCandidates(child, nodes);
    }
  }
}

/**
 * Recursive matcher over a normalized token list.
 * Returns decoded params when the full input is consumed.
 */
function matchSegments(
  tokens: SegmentToken[],
  inputSegments: string[],
): Record<string, string> | null {
  const params: Record<string, string> = {};
  return visit(0, 0) ? params : null;

  function visit(tokenIndex: number, inputIndex: number): boolean {
    if (tokenIndex === tokens.length) {
      return inputIndex === inputSegments.length;
    }

    const token = tokens[tokenIndex];
    if (!token || token.type === "group") {
      return visit(tokenIndex + 1, inputIndex);
    }

    if (token.type === "static") {
      return inputSegments[inputIndex] === token.value
        ? visit(tokenIndex + 1, inputIndex + 1)
        : false;
    }

    if (token.type === "dynamic") {
      const segment = inputSegments[inputIndex];
      if (!segment) {
        return false;
      }

      params[token.name] = segment;
      if (visit(tokenIndex + 1, inputIndex + 1)) {
        return true;
      }

      delete params[token.name];
      return false;
    }

    const minimumRemainingSegments = countMinimumRemainingSegments(tokens, tokenIndex + 1);
    const maxEnd = inputSegments.length - minimumRemainingSegments;
    const startEnd = token.type === "optional-catchall" ? inputIndex : inputIndex + 1;
    // Catchall is greedy, but still needs to leave enough segments for the remaining tokens.
    for (let end = startEnd; end <= maxEnd; end += 1) {
      if (end === inputIndex && token.type === "optional-catchall") {
        delete params[token.name];
      } else {
        params[token.name] = inputSegments.slice(inputIndex, end).join("/");
      }

      if (visit(tokenIndex + 1, end)) {
        return true;
      }
    }

    delete params[token.name];
    return false;
  }
}

/**
 * Counts the minimum number of remaining input segments needed to finish a match.
 */
function countMinimumRemainingSegments(tokens: SegmentToken[], startIndex: number): number {
  let count = 0;

  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.type === "group") {
      continue;
    }

    if (token.type === "optional-catchall") {
      continue;
    }

    count += 1;
  }

  return count;
}

/**
 * Flattens entries from the matched branch in root-to-leaf order.
 */
function collectMatchedEntries<TMeta, TEntryKind extends string>(
  nodes: RouteNode<TMeta, TEntryKind>[],
): Array<MatchedEntry<TMeta, TEntryKind>> {
  const entries: Array<MatchedEntry<TMeta, TEntryKind>> = [];

  for (const node of nodes) {
    for (const entry of node.entries) {
      entries.push({
        node,
        entry,
      });
    }
  }

  return entries;
}

/**
 * Specificity ordering prefers:
 * - more static segments
 * - then dynamic segments
 * - then catchalls
 * - then longer routes
 */
function compareSpecificity(left: SegmentToken[], right: SegmentToken[]): number {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftWeight = getSegmentWeight(left[index]);
    const rightWeight = getSegmentWeight(right[index]);
    if (leftWeight !== rightWeight) {
      return rightWeight - leftWeight;
    }
  }

  if (left.length !== right.length) {
    return right.length - left.length;
  }

  return serializeSegments(left).localeCompare(serializeSegments(right));
}

/**
 * Higher weights win during candidate ordering.
 */
function getSegmentWeight(segment?: SegmentToken): number {
  if (!segment) {
    return 0;
  }

  if (segment.type === "static") {
    return 3;
  }

  if (segment.type === "dynamic") {
    return 2;
  }

  if (segment.type === "catchall") {
    return 1;
  }

  if (segment.type === "optional-catchall") {
    return -1;
  }

  return 0;
}

/**
 * Stable serialization used as the final tie-breaker between equally specific routes.
 */
function serializeSegments(segments: SegmentToken[]): string {
  return segments
    .map((segment) => {
      if (segment.type === "static") {
        return `static:${segment.value}`;
      }

      if (segment.type === "dynamic") {
        return `dynamic:${segment.name}`;
      }

      if (segment.type === "catchall") {
        return `catchall:${segment.name}`;
      }

      if (segment.type === "optional-catchall") {
        return `optional-catchall:${segment.name}`;
      }

      return `group:${segment.name}`;
    })
    .join("/");
}
