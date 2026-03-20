import type { SegmentToken } from "./types.ts";

/**
 * Segment parsing is intentionally conservative.
 * Only the syntax already supported by the current design is accepted.
 */
export function parseSegment(segment: string): SegmentToken {
  if (isGroupSegment(segment)) {
    const name = segment.slice(1, -1);
    assertValidIdentifier(name, segment);
    return {
      type: "group",
      name,
    };
  }

  if (isCatchallSegment(segment)) {
    const name = segment.slice(4, -1);
    assertValidIdentifier(name, segment);
    return {
      type: "catchall",
      name,
    };
  }

  if (isOptionalCatchallSegment(segment)) {
    const name = segment.slice(5, -2);
    assertValidIdentifier(name, segment);
    return {
      type: "optional-catchall",
      name,
    };
  }

  if (segment.startsWith("[[") && segment.endsWith("]]")) {
    throw new Error(`Unsupported route segment syntax "${segment}".`);
  }

  if (isDynamicSegment(segment)) {
    const name = segment.slice(1, -1);
    assertValidIdentifier(name, segment);
    return {
      type: "dynamic",
      name,
    };
  }

  if (/[[\]()]/.test(segment)) {
    throw new Error(`Unsupported route segment syntax "${segment}".`);
  }

  return {
    type: "static",
    value: segment,
  };
}

/**
 * `(group)` contributes tree structure but not URL structure.
 */
function isGroupSegment(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")") && segment.length > 2;
}

/**
 * `[...slug]` greedily captures one or more path segments.
 */
function isCatchallSegment(segment: string): boolean {
  return segment.startsWith("[...") && segment.endsWith("]") && segment.length > 5;
}

/**
 * `[[...slug]]` captures zero or more path segments.
 */
function isOptionalCatchallSegment(segment: string): boolean {
  return segment.startsWith("[[...") && segment.endsWith("]]") && segment.length > 7;
}

/**
 * `[slug]` captures exactly one path segment.
 */
function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]") && segment.length > 2;
}

/**
 * Param names stay intentionally simple because they are later reused in patterns and adapter metadata.
 */
function assertValidIdentifier(name: string, segment: string): void {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error(`Invalid route segment "${segment}".`);
  }
}
