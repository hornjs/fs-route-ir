import type { BuildOptions } from "./types.ts";

/**
 * Shared path helpers stay separate so parsing, building and matching can reuse the same normalization rules.
 */
export function normalizePath(input: string): string {
  const normalized = input.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!normalized || normalized === ".") {
    return "";
  }

  const withoutLeadingDot = normalized.replace(/^\.\/+/, "");
  if (withoutLeadingDot === "/") {
    return "";
  }

  return withoutLeadingDot.replace(/\/$/, "");
}

/**
 * Removes the configured root prefix when the input file lives under that root.
 */
export function stripRootPrefix(input: string, root?: string): string {
  const normalizedRoot = normalizePath(root ?? "");
  if (!normalizedRoot || normalizedRoot === ".") {
    return input;
  }

  if (input === normalizedRoot) {
    return "";
  }

  if (input.startsWith(`${normalizedRoot}/`)) {
    return input.slice(normalizedRoot.length + 1);
  }

  return input;
}

/**
 * Normalizes a file path into the route path used by file-based mode.
 */
export function normalizeFileRouteInput(input: string): string {
  if (!input) {
    return "";
  }

  // In file-based mode `index` only affects filesystem layout, not the final URL.
  const withoutExtension = stripFileExtension(input);
  const segments = withoutExtension.split("/").filter(Boolean);
  if (segments[segments.length - 1] === "index") {
    segments.pop();
  }

  return segments.join("/");
}

/**
 * Strips only the final file extension from the last path segment.
 */
export function stripFileExtension(file: string): string {
  const dir = getDirectory(file);
  const fileName = getFileName(file);
  const extensionIndex = fileName.lastIndexOf(".");
  const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;

  return dir ? `${dir}/${baseName}` : baseName;
}

/**
 * Returns the parent directory portion of a path, or an empty string for root-level files.
 */
export function getDirectory(path: string): string {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex >= 0 ? path.slice(0, separatorIndex) : "";
}

/**
 * Returns the next parent directory, using `null` to signal the walk is finished.
 */
export function getParentDirectory(dir: string): string | null {
  if (!dir) {
    return null;
  }

  const separatorIndex = dir.lastIndexOf("/");
  return separatorIndex >= 0 ? dir.slice(0, separatorIndex) : "";
}

/**
 * Returns the last path segment as-is.
 */
export function getFileName(path: string): string {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

/**
 * Returns the last path segment without its final extension.
 */
export function getBaseName(path: string): string {
  const fileName = getFileName(path);
  const extensionIndex = fileName.lastIndexOf(".");
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
}

/**
 * Collects ancestor directories from root to leaf.
 * The empty string is preserved only when the current directory itself is the logical root.
 */
export function collectDirAncestors(dir: string, includeSelf: boolean): string[] {
  const ancestors: string[] = [];
  let current = includeSelf ? dir : getParentDirectory(dir);

  while (current !== null) {
    ancestors.unshift(current);
    current = getParentDirectory(current);
  }

  return ancestors.filter((ancestor, index, allAncestors) => {
    if (ancestor !== "") {
      return true;
    }

    return allAncestors.length === 1 || index === allAncestors.length - 1;
  });
}

/**
 * Checks whether any parent directory has been ignored.
 * Results are cached because many files share the same parent directories.
 */
export function isIgnoredDirectory(
  file: string,
  ignore: BuildOptions["ignore"],
  cache: Map<string, boolean>,
): boolean {
  if (!ignore) {
    return false;
  }

  const visitedDirs: string[] = [];
  let current: string | null = getDirectory(file);
  while (current !== null) {
    const cached = cache.get(current);
    if (cached !== undefined) {
      for (const visitedDir of visitedDirs) {
        cache.set(visitedDir, cached);
      }
      return cached;
    }

    visitedDirs.push(current);
    const ignored = current !== "" && ignore(current, "dir");
    if (ignored) {
      for (const visitedDir of visitedDirs) {
        cache.set(visitedDir, true);
      }
      return true;
    }

    current = getParentDirectory(current);
  }

  for (const visitedDir of visitedDirs) {
    cache.set(visitedDir, false);
  }

  return false;
}

export function createDirectoryNodeId(dir: string): string {
  // Directory containers in file-based mode need stable ids that cannot collide with file ids.
  return `dir:${dir}`;
}

export function splitPathname(path: string): string[] {
  const pathname = new URL(path, "http://localhost").pathname;
  if (!pathname || pathname === "/") {
    return [];
  }

  // Matching always happens against decoded URL segments.
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

/**
 * Small helper used throughout the builder to keep iteration order deterministic.
 */
export function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}
