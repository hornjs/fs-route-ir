import { normalizeFileRouteInput, normalizePath, stripRootPrefix } from "./path-utils.ts";
import { parseSegment } from "./segments.ts";
import type { ParsePathOptions, ParsedPath, PatternParam } from "./types.ts";

/**
 * Parses a relative file path into a normalized routing shape.
 * The result is stable enough to be reused by both the tree builder and conflict detection.
 * `pattern` keeps public URL intent, while `signature` is intentionally lossy for ambiguity checks.
 *
 * @example
 * ```ts
 * const parsed = parsePath("app/routes/blog/[slug]/index.vue", {
 *   profile: "file-based",
 *   root: "app/routes",
 * });
 *
 * parsed.pattern;
 * // "/blog/:slug"
 *
 * parsed.signature;
 * // "/blog/:"
 *
 * const custom = parsePath("users/[id].ts", {
 *   profile: "file-based",
 *   formatParam(param) {
 *     return `{${param.name}}`;
 *   },
 * });
 *
 * custom.pattern;
 * // "/users/{id}"
 * ```
 */
export function parsePath(input: string, options: ParsePathOptions): ParsedPath {
  const normalizedInput = normalizePath(input);
  const relativeInput = stripRootPrefix(normalizedInput, options.root);
  // File-based mode treats extensions and trailing `index` as transport details, not path segments.
  const preparedInput =
    options.profile === "file-based" ? normalizeFileRouteInput(relativeInput) : relativeInput;
  const rawSegments = preparedInput ? preparedInput.split("/").filter(Boolean) : [];
  const segments = rawSegments.map((segment) => parseSegment(segment));
  const params: ParsedPath["params"] = [];
  const patternSegments: string[] = [];
  const signatureSegments: string[] = [];
  const formatParam = options.formatParam ?? defaultFormatParam;

  // A single pass derives all downstream representations from the same token list.
  for (const token of segments) {
    if (token.type === "group") {
      continue;
    }

    if (token.type === "static") {
      patternSegments.push(token.value);
      signatureSegments.push(token.value);
      continue;
    }

    if (token.type === "dynamic") {
      const param: PatternParam = {
        name: token.name,
        kind: "one",
      };
      params.push(param);
      patternSegments.push(formatParam(param));
      // Signature removes param names so structurally equivalent routes conflict.
      signatureSegments.push(":");
      continue;
    }

    const param: PatternParam =
      token.type === "optional-catchall"
        ? {
            name: token.name,
            kind: "many",
            optional: true,
          }
        : {
            name: token.name,
            kind: "many",
          };
    params.push(param);
    // Catchall names are also erased in the signature because only structure matters for conflicts.
    patternSegments.push(formatParam(param));
    signatureSegments.push("*");
  }

  return {
    input: normalizedInput,
    profile: options.profile,
    segments,
    pattern: patternSegments.length > 0 ? `/${patternSegments.join("/")}` : "/",
    signature: signatureSegments.length > 0 ? `/${signatureSegments.join("/")}` : "/",
    params,
  };
}

function defaultFormatParam(param: PatternParam): string {
  if (param.kind === "one") {
    return `:${param.name}`;
  }

  return "*";
}
