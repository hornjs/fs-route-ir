import { describe, expect, it, vi } from "vitest";

import {
  collectDirAncestors,
  createDirectoryNodeId,
  getBaseName,
  getDirectory,
  getFileName,
  getParentDirectory,
  isIgnoredDirectory,
  normalizeFileRouteInput,
  normalizePath,
  sortStrings,
  splitPathname,
  stripFileExtension,
  stripRootPrefix,
} from "../src/path-utils.ts";

describe("path utils", () => {
  it("normalizes paths and strips roots", () => {
    expect(normalizePath(".\\app//pages/blog/")).toBe("app/pages/blog");
    expect(stripRootPrefix("app/pages/blog/page.vue", "app/pages")).toBe("blog/page.vue");
    expect(stripRootPrefix("blog/page.vue", "app/pages")).toBe("blog/page.vue");
  });

  it("normalizes file-based route inputs", () => {
    expect(normalizeFileRouteInput("blog/index.vue")).toBe("blog");
    expect(normalizeFileRouteInput("robots.txt.ts")).toBe("robots.txt");
    expect(stripFileExtension("blog/page.vue")).toBe("blog/page");
    expect(getDirectory("blog/page.vue")).toBe("blog");
    expect(getParentDirectory("blog/post")).toBe("blog");
    expect(getParentDirectory("")).toBeNull();
    expect(getFileName("blog/page.vue")).toBe("page.vue");
    expect(getBaseName("blog/page.vue")).toBe("page");
  });

  it("collects ancestors and splits pathnames", () => {
    expect(collectDirAncestors("blog/post", true)).toEqual(["blog", "blog/post"]);
    expect(collectDirAncestors("blog/post", false)).toEqual(["blog"]);
    expect(splitPathname("/users/hello%20world?tab=1")).toEqual(["users", "hello world"]);
    expect(createDirectoryNodeId("api")).toBe("dir:api");
    expect(sortStrings(["b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("caches ignored ancestor lookups without losing parent state", () => {
    const ignore = vi.fn(
      (entry: string, kind: "file" | "dir") => kind === "dir" && entry === "blog",
    );
    const cache = new Map<string, boolean>();

    expect(isIgnoredDirectory("blog/post/page.vue", ignore, cache)).toBe(true);

    const callCount = ignore.mock.calls.length;
    expect(isIgnoredDirectory("blog/post/other.vue", ignore, cache)).toBe(true);
    expect(ignore).toHaveBeenCalledTimes(callCount);
  });
});
