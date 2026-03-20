/**
 * Public API surface for building route IR from file-style paths.
 *
 * @example
 * ```ts
 * import { build, createMatcher, parsePath } from "fs-route-ir";
 *
 * const parsed = parsePath("blog/[slug].ts", {
 *   profile: "file-based",
 *   formatParam(param) {
 *     return `{${param.name}}`;
 *   },
 * });
 *
 * const result = build(["blog/[slug].ts"], {
 *   profile: "file-based",
 *   root: "",
 *   defineEntry() {
 *     return { kind: "route" };
 *   },
 * });
 *
 * const match = createMatcher(result)("/blog/hello");
 * ```
 */
export * from "./types.ts";
export { parsePath } from "./parse-path.ts";
export { build, walkTree } from "./build.ts";
export { createMatcher } from "./matcher.ts";
