/**
 * Core design:
 * - `directory-based`: directories define route nodes and files become entries on those nodes.
 * - `file-based`: files define route leaves and directories only preserve hierarchy / directory-scoped entries.
 * - `meta` and entry definitions are delegated to callers so this package stays generic.
 *
 * @example
 * ```ts
 * const profile: RouteProfile = "directory-based";
 * ```
 */
export type RouteProfile = "directory-based" | "file-based";

/**
 * A parsed path is modeled as a flat segment list.
 * Group segments stay in the tree model but are removed from the public URL pattern.
 */
export type SegmentToken =
  | { type: "static"; value: string }
  | { type: "dynamic"; name: string }
  | { type: "catchall"; name: string }
  | { type: "optional-catchall"; name: string }
  | { type: "group"; name: string };

export interface ParsedPath {
  /** Normalized filesystem input after slash cleanup, before profile-specific transforms. */
  input: string;
  /** Parsing mode used for this path. */
  profile: RouteProfile;
  /** Original segment sequence, including group segments. */
  segments: SegmentToken[];
  /** Public URL pattern with groups removed and params normalized. */
  pattern: string;
  // Signature erases param names so `/users/[id]` and `/users/[slug]` collide.
  signature: string;
  /** Ordered parameter list used by adapters that need richer metadata than `pattern` alone. */
  params: Array<{
    name: string;
    kind: "one" | "many";
    optional?: boolean;
  }>;
}

export interface PatternParam {
  /** Original param name from the file-style path segment. */
  name: string;
  /** `one` for `[id]`, `many` for `[...parts]` and `[[...parts]]`. */
  kind: "one" | "many";
  /** Present only for `[[...parts]]`. */
  optional?: boolean;
}

export type FormatParam = (param: PatternParam) => string;

export interface ParsePathOptions {
  /** Parsing mode used to interpret the input path. */
  profile: RouteProfile;
  /** Optional path prefix removed before segment parsing. */
  root?: string;
  /**
   * Optional formatter for parameter-like segments in `pattern`.
   * Defaults to `:${name}` for single params and `*` for catchalls.
   */
  formatParam?: FormatParam;
}

/**
 * Entries are files attached to a node. Their runtime meaning is defined by the caller.
 */
export interface RouteEntry<TEntryKind extends string = string> {
  /** Caller-defined entry kind such as a view, data loader, or handler role. */
  kind: TEntryKind;
  /** File path relative to the configured root. */
  file: string;
  /** Whether the file attaches to the current node or to its containing directory node. */
  scope: "node" | "directory";
}

/**
 * Route nodes describe only the path tree.
 * Concrete files live in `entries`; their meaning is defined by the caller.
 */
export interface RouteNode<TMeta = unknown, TEntryKind extends string = string> {
  /** Stable node identifier used by adapters and `pathIndex`. */
  id: string;
  /** Directory path represented by this node. */
  dir: string;
  /** Public URL pattern for this node. */
  pattern: string;
  /** Full parsed segment list for matching and specificity ordering. */
  segments: SegmentToken[];
  /** Files attached to this node. */
  entries: RouteEntry<TEntryKind>[];
  /** Caller-defined metadata derived during build. */
  meta?: TMeta;
  /** Child nodes in the route tree. */
  children: RouteNode<TMeta, TEntryKind>[];
}

export interface RouteTree<TMeta = unknown, TEntryKind extends string = string> {
  /** Tree shape strategy used to build this result. */
  profile: RouteProfile;
  /** Top-level nodes. */
  nodes: RouteNode<TMeta, TEntryKind>[];
}

/**
 * `pathIndex` tracks routable node ids by normalized signature.
 * `dirFiles` preserves raw directory contents so adapters can derive extra semantics on top.
 */
export interface BuildResult<TMeta = unknown, TEntryKind extends string = string> {
  /** Fully linked route tree. */
  tree: RouteTree<TMeta, TEntryKind>;
  /** Fast lookup from structural signature to routable node id. */
  pathIndex: Map<string, string>;
  /** Raw file listing per directory after filtering and normalization. */
  dirFiles: Map<string, string[]>;
}

export interface MatchedEntry<TMeta = unknown, TEntryKind extends string = string> {
  /** Node that contributed this entry to the match. */
  node: RouteNode<TMeta, TEntryKind>;
  /** Entry attached to that node. */
  entry: RouteEntry<TEntryKind>;
}

export interface PathMatch<TMeta = unknown, TEntryKind extends string = string> {
  /** Decoded path params collected during matching. Catchall params are slash-joined. */
  params: Record<string, string>;
  /** Full ancestry from root to the matched leaf. */
  nodes: RouteNode<TMeta, TEntryKind>[];
  /** The routable node selected by the matcher. */
  leaf: RouteNode<TMeta, TEntryKind>;
  /** Flattened entries contributed by every node in the matched branch. */
  entries: MatchedEntry<TMeta, TEntryKind>[];
}

export type RouteMatcher<TMeta = unknown, TEntryKind extends string = string> = (
  path: string,
) => PathMatch<TMeta, TEntryKind> | null;

export interface EntryDefinition<TEntryKind extends string = string> {
  /** Caller-defined role assigned to the file. */
  kind: TEntryKind;
  /** Defaults to `node` when omitted. */
  scope?: "node" | "directory";
}

/**
 * `defineEntry` decides file roles.
 * `isRouteFile` only answers whether a file creates a file-based leaf.
 *
 * @example
 * ```ts
 * const options: BuildOptions = {
 *   profile: "file-based",
 *   root: "server/routes",
 *   formatParam(param) {
 *     return param.kind === "one" ? `{${param.name}}` : `{...${param.name}}`;
 *   },
 *   defineEntry({ baseName }) {
 *     if (baseName === "_guard") {
 *       return { kind: "directory-guard", scope: "directory" };
 *     }
 *
 *     return { kind: "endpoint" };
 *   },
 *   isRouteFile(file) {
 *     return !file.endsWith("_guard.ts");
 *   },
 * };
 * ```
 */
export interface BuildOptions<TMeta = unknown, TEntryKind extends string = string> {
  /** Tree construction strategy. */
  profile: RouteProfile;
  /** Filesystem root stripped from every input file before parsing. */
  root: string;
  /** Optional formatter forwarded to `parsePath()` when building node patterns. */
  formatParam?: FormatParam;
  /** Optional ignore hook for both files and directories. */
  ignore?: (entry: string, kind: "file" | "dir") => boolean;
  /** Maps a file to an attached entry or excludes it from entries when returning `null`. */
  defineEntry: (ctx: {
    profile: RouteProfile;
    file: string;
    dir: string;
    baseName: string;
  }) => EntryDefinition<TEntryKind> | null;
  /** File-based only: determines whether a file generates a routable leaf. */
  isRouteFile?: (file: string) => boolean;
  /** Optional hook for deriving adapter metadata from normalized nodes. */
  createMeta?: (ctx: {
    id: string;
    dir: string;
    parsed: ParsedPath;
    entries: RouteEntry<TEntryKind>[];
    files: string[];
    isLeaf: boolean;
  }) => TMeta;
}
