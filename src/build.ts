import { parsePath } from "./parse-path.ts";
import {
  collectDirAncestors,
  createDirectoryNodeId,
  getBaseName,
  getDirectory,
  getParentDirectory,
  isIgnoredDirectory,
  normalizePath,
  sortStrings,
  stripFileExtension,
  stripRootPrefix,
} from "./path-utils.ts";
import type {
  BuildOptions,
  BuildResult,
  EntryDefinition,
  ParsedPath,
  RouteEntry,
  RouteNode,
  RouteProfile,
} from "./types.ts";

/**
 * Builder design:
 * - the core only constructs a path tree plus attached entries
 * - file roles come from `defineEntry()`
 * - the core never assigns runtime behavior to those entries
 */
interface SourceFile {
  file: string;
  dir: string;
  baseName: string;
}

interface DirectoryNodeRecord<TMeta, TEntryKind extends string> {
  node: RouteNode<TMeta, TEntryKind>;
  parsed: ParsedPath;
}

/**
 * Builds a normalized route tree from filesystem paths.
 *
 * @example
 * ```ts
 * const result = build(
 *   ["app/routes/view.vue", "app/routes/blog/[slug]/view.vue"],
 *   {
 *     profile: "directory-based",
 *     root: "app/routes",
 *     formatParam(param) {
 *       return param.kind === "one" ? `{${param.name}}` : `{...${param.name}}`;
 *     },
 *     defineEntry({ baseName }) {
 *       if (baseName === "view") {
 *         return { kind: "view" };
 *       }
 *
 *       return null;
 *     },
 *   },
 * );
 *
 * result.tree.nodes[0]?.pattern;
 * // "/"
 * ```
 */
export function build<TMeta = unknown, TEntryKind extends string = string>(
  files: string[],
  options: BuildOptions<TMeta, TEntryKind>,
): BuildResult<TMeta, TEntryKind> {
  const preparedFiles = prepareSourceFiles(files, options);
  return options.profile === "directory-based"
    ? buildDirectoryBased(preparedFiles, options)
    : buildFileBased(preparedFiles, options);
}

/**
 * Walks the built tree in depth-first order.
 * Returning `false` from the visitor stops the traversal immediately.
 *
 * @example
 * ```ts
 * walkTree(result, (node, depth, parent) => {
 *   console.log(depth, parent?.id, node.id);
 * });
 * ```
 */
export function walkTree<TMeta = unknown, TEntryKind extends string = string>(
  result: BuildResult<TMeta, TEntryKind>,
  visitor: (
    node: RouteNode<TMeta, TEntryKind>,
    depth: number,
    parent: RouteNode<TMeta, TEntryKind> | null,
  ) => boolean | void,
): void {
  for (const root of result.tree.nodes) {
    if (!visit(root, 0, null)) {
      return;
    }
  }

  function visit(
    node: RouteNode<TMeta, TEntryKind>,
    depth: number,
    parent: RouteNode<TMeta, TEntryKind> | null,
  ): boolean {
    if (visitor(node, depth, parent) === false) {
      return false;
    }

    for (const child of node.children) {
      if (!visit(child, depth + 1, node)) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Directory-based mode treats every required directory as a node.
 * Files only contribute entries to those nodes.
 */
function buildDirectoryBased<TMeta, TEntryKind extends string>(
  sourceFiles: SourceFile[],
  options: BuildOptions<TMeta, TEntryKind>,
): BuildResult<TMeta, TEntryKind> {
  const dirFiles = createDirFilesMap(sourceFiles);
  const pathIndex = new Map<string, string>();
  const nodeRecords = new Map<string, DirectoryNodeRecord<TMeta, TEntryKind>>();
  const requiredDirs = new Set<string>();

  // A deep file implies every ancestor directory must exist as a node to keep the tree connected.
  for (const sourceFile of sourceFiles) {
    for (const ancestorDir of collectDirAncestors(sourceFile.dir, true)) {
      requiredDirs.add(ancestorDir);
    }
  }

  for (const dir of sortStrings(requiredDirs.values())) {
    const parsed = parsePath(dir, {
      profile: "directory-based",
      formatParam: options.formatParam,
    });
    registerPathSignature(pathIndex, parsed.signature, dir);

    nodeRecords.set(dir, {
      parsed,
      node: {
        id: dir,
        dir,
        pattern: parsed.pattern,
        segments: parsed.segments,
        entries: createDirectoryEntries(dirFiles.get(dir) ?? [], options, "directory-based"),
        children: [],
      },
    });
  }

  const roots = linkDirectoryTree(nodeRecords, false);
  applyMeta(nodeRecords, dirFiles, options);

  return {
    tree: {
      profile: "directory-based",
      nodes: roots,
    },
    pathIndex,
    dirFiles,
  };
}

/**
 * File-based mode builds directory containers first, then attaches file leaves under them.
 * This keeps directory-scoped entries and file leaves in the same tree without conflating them.
 */
function buildFileBased<TMeta, TEntryKind extends string>(
  sourceFiles: SourceFile[],
  options: BuildOptions<TMeta, TEntryKind>,
): BuildResult<TMeta, TEntryKind> {
  const dirFiles = createDirFilesMap(sourceFiles);
  const pathIndex = new Map<string, string>();
  const dirNodeRecords = new Map<string, DirectoryNodeRecord<TMeta, TEntryKind>>();
  const leafNodeRecords = new Map<string, DirectoryNodeRecord<TMeta, TEntryKind>>();
  const routeFileFilter = options.isRouteFile ?? (() => true);
  const entryDefinitions = new Map<string, EntryDefinition<TEntryKind> | null>();
  const routeFiles = new Set<string>();
  const requiredDirs = new Set<string>();

  // In file-based mode, route leaves and entry roles are related but intentionally separated.
  for (const sourceFile of sourceFiles) {
    const definition = options.defineEntry({
      profile: "file-based",
      file: sourceFile.file,
      dir: sourceFile.dir,
      baseName: sourceFile.baseName,
    });
    entryDefinitions.set(sourceFile.file, definition);

    if (routeFileFilter(sourceFile.file)) {
      routeFiles.add(sourceFile.file);
      for (const ancestorDir of collectDirAncestors(sourceFile.dir, true)) {
        requiredDirs.add(ancestorDir);
      }
    }

    if (definition?.scope === "directory") {
      for (const ancestorDir of collectDirAncestors(sourceFile.dir, true)) {
        requiredDirs.add(ancestorDir);
      }
    }
  }

  for (const dir of sortStrings(requiredDirs.values())) {
    const parsed = parsePath(dir, {
      profile: "file-based",
      formatParam: options.formatParam,
    });
    dirNodeRecords.set(dir, {
      parsed,
      node: {
        id: createDirectoryNodeId(dir),
        dir,
        pattern: parsed.pattern,
        segments: parsed.segments,
        entries: [],
        children: [],
      },
    });
  }

  for (const sourceFile of sourceFiles) {
    if (!routeFiles.has(sourceFile.file)) {
      continue;
    }

    const leafId = stripFileExtension(sourceFile.file);
    const parsed = parsePath(sourceFile.file, {
      profile: "file-based",
      formatParam: options.formatParam,
    });
    registerPathSignature(pathIndex, parsed.signature, leafId);

    leafNodeRecords.set(leafId, {
      parsed,
      node: {
        id: leafId,
        dir: sourceFile.dir,
        pattern: parsed.pattern,
        segments: parsed.segments,
        entries: [],
        children: [],
      },
    });
  }

  for (const sourceFile of sourceFiles) {
    const definition = entryDefinitions.get(sourceFile.file);
    if (!definition) {
      continue;
    }

    const entry: RouteEntry<TEntryKind> = {
      kind: definition.kind,
      file: sourceFile.file,
      scope: definition.scope ?? "node",
    };

    if (entry.scope === "directory") {
      const dirNode = dirNodeRecords.get(sourceFile.dir);
      if (dirNode) {
        dirNode.node.entries.push(entry);
      }
      continue;
    }

    if (!routeFiles.has(sourceFile.file)) {
      // Node-scoped entries must be attachable to a concrete leaf. Silently dropping them hides errors.
      throw new Error(
        `Node-scoped entry "${sourceFile.file}" must also be a route file in file-based mode.`,
      );
    }

    const leafId = stripFileExtension(sourceFile.file);
    const leafNode = leafNodeRecords.get(leafId);
    if (leafNode) {
      leafNode.node.entries.push(entry);
    }
  }

  sortEntries(dirNodeRecords);
  sortEntries(leafNodeRecords);

  const roots = linkFileTree(dirNodeRecords, leafNodeRecords);
  applyMeta(dirNodeRecords, dirFiles, options);
  applyMeta(leafNodeRecords, dirFiles, options);

  return {
    tree: {
      profile: "file-based",
      nodes: roots,
    },
    pathIndex,
    dirFiles,
  };
}

/**
 * Normalizes inputs into a deterministic, deduplicated source file list.
 * All later stages operate on these normalized relative paths only.
 */
function prepareSourceFiles<TMeta, TEntryKind extends string>(
  files: string[],
  options: BuildOptions<TMeta, TEntryKind>,
): SourceFile[] {
  const sourceFiles: SourceFile[] = [];
  const seenFiles = new Set<string>();
  const ignoredDirs = new Map<string, boolean>();

  for (const file of files) {
    const relativeFile = stripRootPrefix(normalizePath(file), options.root);
    if (!relativeFile || relativeFile.endsWith("/")) {
      continue;
    }

    if (isIgnoredDirectory(relativeFile, options.ignore, ignoredDirs)) {
      continue;
    }

    if (options.ignore?.(relativeFile, "file")) {
      continue;
    }

    if (seenFiles.has(relativeFile)) {
      continue;
    }

    seenFiles.add(relativeFile);
    sourceFiles.push({
      file: relativeFile,
      dir: getDirectory(relativeFile),
      baseName: getBaseName(relativeFile),
    });
  }

  sourceFiles.sort((left, right) => left.file.localeCompare(right.file));
  return sourceFiles;
}

/**
 * Preserves the direct file listing for each directory so adapters can inspect sidecars later.
 */
function createDirFilesMap(sourceFiles: SourceFile[]): Map<string, string[]> {
  const dirFiles = new Map<string, string[]>();

  for (const sourceFile of sourceFiles) {
    const files = dirFiles.get(sourceFile.dir);
    if (files) {
      files.push(sourceFile.file);
      continue;
    }

    dirFiles.set(sourceFile.dir, [sourceFile.file]);
  }

  for (const files of dirFiles.values()) {
    files.sort((left, right) => left.localeCompare(right));
  }

  return dirFiles;
}

/**
 * Classifies every file in a directory and turns the caller's result into normalized entries.
 */
function createDirectoryEntries<TEntryKind extends string>(
  files: string[],
  options: BuildOptions<unknown, TEntryKind>,
  profile: RouteProfile,
): RouteEntry<TEntryKind>[] {
  const entries: RouteEntry<TEntryKind>[] = [];

  for (const file of files) {
    const entry = options.defineEntry({
      profile,
      file,
      dir: getDirectory(file),
      baseName: getBaseName(file),
    });

    if (!entry) {
      continue;
    }

    entries.push({
      kind: entry.kind,
      file,
      scope: entry.scope ?? "node",
    });
  }

  entries.sort((left, right) => left.file.localeCompare(right.file));
  return entries;
}

/**
 * Links directory records into a tree by nearest existing parent directory.
 * For file-based mode the synthetic root directory node is kept first when it exists.
 */
function linkDirectoryTree<TMeta, TEntryKind extends string>(
  nodeRecords: Map<string, DirectoryNodeRecord<TMeta, TEntryKind>>,
  useDirectoryIdPrefix: boolean,
): RouteNode<TMeta, TEntryKind>[] {
  const roots: RouteNode<TMeta, TEntryKind>[] = [];

  for (const dir of sortStrings(nodeRecords.keys())) {
    const record = nodeRecords.get(dir);
    if (!record) {
      continue;
    }

    const parent = findNearestParentRecord(nodeRecords, dir);
    if (parent) {
      parent.node.children.push(record.node);
      continue;
    }

    if (useDirectoryIdPrefix && record.node.id === createDirectoryNodeId("")) {
      roots.unshift(record.node);
      continue;
    }

    roots.push(record.node);
  }

  sortNodeTree(roots);
  return roots;
}

/**
 * Attaches file leaves under directory containers when possible.
 * Leaves without a container remain top-level roots.
 */
function linkFileTree<TMeta, TEntryKind extends string>(
  dirNodeRecords: Map<string, DirectoryNodeRecord<TMeta, TEntryKind>>,
  leafNodeRecords: Map<string, DirectoryNodeRecord<TMeta, TEntryKind>>,
): RouteNode<TMeta, TEntryKind>[] {
  const roots = linkDirectoryTree(dirNodeRecords, true);
  const rootNodes = [...roots];

  // File leaves attach to their nearest directory container when possible.
  for (const leafId of sortStrings(leafNodeRecords.keys())) {
    const record = leafNodeRecords.get(leafId);
    if (!record) {
      continue;
    }

    const parent = dirNodeRecords.get(record.node.dir);
    if (parent) {
      parent.node.children.push(record.node);
      continue;
    }

    rootNodes.push(record.node);
  }

  sortNodeTree(rootNodes);
  return rootNodes;
}

/**
 * Runs caller metadata derivation after the tree and entries are fully linked.
 */
function applyMeta<TMeta, TEntryKind extends string>(
  nodeRecords: Map<string, DirectoryNodeRecord<TMeta, TEntryKind>>,
  dirFiles: Map<string, string[]>,
  options: BuildOptions<TMeta, TEntryKind>,
): void {
  if (!options.createMeta) {
    return;
  }

  for (const key of sortStrings(nodeRecords.keys())) {
    const record = nodeRecords.get(key);
    if (!record) {
      continue;
    }

    record.node.meta = options.createMeta({
      id: record.node.id,
      dir: record.node.dir,
      parsed: record.parsed,
      entries: [...record.node.entries],
      files: [...(dirFiles.get(record.node.dir) ?? [])],
      isLeaf: record.node.children.length === 0,
    });
  }
}

/**
 * Keeps entry order deterministic for stable tests and stable declaration output.
 */
function sortEntries<TMeta, TEntryKind extends string>(
  nodeRecords: Map<string, DirectoryNodeRecord<TMeta, TEntryKind>>,
): void {
  for (const record of nodeRecords.values()) {
    record.node.entries.sort((left, right) => left.file.localeCompare(right.file));
  }
}

/**
 * Sorts every sibling list by id so the built tree is deterministic regardless of input order.
 */
function sortNodeTree<TMeta, TEntryKind extends string>(
  nodes: Array<RouteNode<TMeta, TEntryKind>>,
): void {
  nodes.sort((left, right) => left.id.localeCompare(right.id));

  for (const node of nodes) {
    sortNodeTree(node.children);
  }
}

/**
 * Finds the nearest ancestor directory that already exists as a record.
 */
function findNearestParentRecord<TMeta, TEntryKind extends string>(
  nodeRecords: Map<string, DirectoryNodeRecord<TMeta, TEntryKind>>,
  dir: string,
): DirectoryNodeRecord<TMeta, TEntryKind> | undefined {
  let parentDir = getParentDirectory(dir);
  while (parentDir !== null) {
    const candidate = nodeRecords.get(parentDir);
    if (candidate) {
      return candidate;
    }

    parentDir = getParentDirectory(parentDir);
  }

  return undefined;
}

/**
 * Registers a routable pattern signature and rejects structural ambiguities immediately.
 */
function registerPathSignature(
  pathIndex: Map<string, string>,
  signature: string,
  id: string,
): void {
  // Conflict detection happens on structural signatures rather than raw ids.
  const existing = pathIndex.get(signature);
  if (existing) {
    throw new Error(`Ambiguous route pattern "${signature}" for nodes "${existing}" and "${id}".`);
  }

  pathIndex.set(signature, id);
}
