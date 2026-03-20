import { describe, expect, it } from "vitest";

import { build, walkTree } from "../src/build.ts";

function defineEntry({ baseName }: { baseName: string }) {
  if (baseName === "_middleware") {
    return { kind: "directory-middleware", scope: "directory" as const };
  }

  if (
    baseName === "page" ||
    baseName === "layout" ||
    baseName === "loader" ||
    baseName === "route"
  ) {
    return { kind: baseName };
  }

  return null;
}

describe("build", () => {
  it("builds a directory-based tree with entries and metadata", () => {
    const result = build(
      [
        "app/pages/layout.ts",
        "app/pages/page.vue",
        "app/pages/blog/[slug]/page.vue",
        "app/pages/blog/[slug]/loader.ts",
      ],
      {
        profile: "directory-based",
        root: "app/pages",
        defineEntry,
        createMeta({ files, isLeaf }) {
          return {
            fileCount: files.length,
            isLeaf,
          };
        },
      },
    );

    const root = result.tree.nodes[0];
    const blog = root?.children[0];
    const blogSlug = blog?.children[0];

    expect(result.tree.profile).toBe("directory-based");
    expect(root).toMatchObject({
      id: "",
      pattern: "/",
      entries: [
        { kind: "layout", file: "layout.ts", scope: "node" },
        { kind: "page", file: "page.vue", scope: "node" },
      ],
      meta: { fileCount: 2, isLeaf: false },
    });
    expect(blog).toMatchObject({
      id: "blog",
      pattern: "/blog",
      entries: [],
    });
    expect(blogSlug).toMatchObject({
      id: "blog/[slug]",
      pattern: "/blog/:slug",
      entries: [
        { kind: "loader", file: "blog/[slug]/loader.ts", scope: "node" },
        { kind: "page", file: "blog/[slug]/page.vue", scope: "node" },
      ],
      meta: { fileCount: 2, isLeaf: true },
    });
    expect(result.pathIndex.get("/")).toBe("");
    expect(result.pathIndex.get("/blog/:")).toBe("blog/[slug]");
    expect(result.dirFiles.get("blog/[slug]")).toEqual([
      "blog/[slug]/loader.ts",
      "blog/[slug]/page.vue",
    ]);
  });

  it("applies custom parameter formatting to built node patterns", () => {
    const result = build(["app/pages/blog/[slug]/page.vue"], {
      profile: "directory-based",
      root: "app/pages",
      formatParam(param) {
        return `{${param.name}}`;
      },
      defineEntry,
    });

    expect(result.tree.nodes[0]?.children[0]).toMatchObject({
      id: "blog/[slug]",
      pattern: "/blog/{slug}",
    });
    expect(result.pathIndex.get("/blog/:")).toBe("blog/[slug]");
  });

  it("builds a file-based tree with directory-scoped entries", () => {
    const result = build(
      [
        "server/routes/api/_middleware.ts",
        "server/routes/api/users/[id].ts",
        "server/routes/robots.txt.ts",
      ],
      {
        profile: "file-based",
        root: "server/routes",
        defineEntry({ baseName }) {
          if (baseName === "_middleware") {
            return { kind: "directory-middleware", scope: "directory" as const };
          }

          return { kind: "route" };
        },
        isRouteFile(file) {
          return !file.endsWith("_middleware.ts");
        },
      },
    );

    const visitedIds: string[] = [];
    walkTree(result, (node) => {
      visitedIds.push(node.id);
    });

    expect(result.tree.profile).toBe("file-based");
    expect(visitedIds).toEqual([
      "dir:",
      "dir:api",
      "dir:api/users",
      "api/users/[id]",
      "robots.txt",
    ]);
    expect(result.tree.nodes[0]).toMatchObject({
      id: "dir:",
      children: [
        {
          id: "dir:api",
          entries: [
            {
              kind: "directory-middleware",
              file: "api/_middleware.ts",
              scope: "directory",
            },
          ],
        },
        {
          id: "robots.txt",
          entries: [{ kind: "route", file: "robots.txt.ts", scope: "node" }],
        },
      ],
    });
    expect(result.pathIndex.get("/api/users/:")).toBe("api/users/[id]");
    expect(result.pathIndex.get("/robots.txt")).toBe("robots.txt");
  });

  it("stops walking when the visitor returns false", () => {
    const result = build(
      [
        "server/routes/api/_middleware.ts",
        "server/routes/api/users/[id].ts",
        "server/routes/robots.txt.ts",
      ],
      {
        profile: "file-based",
        root: "server/routes",
        defineEntry({ baseName }) {
          if (baseName === "_middleware") {
            return { kind: "directory-middleware", scope: "directory" as const };
          }

          return { kind: "route" };
        },
        isRouteFile(file) {
          return !file.endsWith("_middleware.ts");
        },
      },
    );

    const visitedIds: string[] = [];
    walkTree(result, (node) => {
      visitedIds.push(node.id);
      if (node.id === "dir:api/users") {
        return false;
      }
    });

    expect(visitedIds).toEqual(["dir:", "dir:api", "dir:api/users"]);
  });

  it("throws on ambiguous route signatures", () => {
    expect(() =>
      build(["server/routes/users/[id].ts", "server/routes/users/[slug].ts"], {
        profile: "file-based",
        root: "server/routes",
        defineEntry() {
          return { kind: "route" };
        },
      }),
    ).toThrow('Ambiguous route pattern "/users/:"');
  });

  it("treats required and optional catchall routes as the same structural signature", () => {
    expect(() =>
      build(["server/routes/docs/[...slug].ts", "server/routes/docs/[[...slug]].ts"], {
        profile: "file-based",
        root: "server/routes",
        defineEntry() {
          return { kind: "route" };
        },
      }),
    ).toThrow('Ambiguous route pattern "/docs/*"');
  });

  it("throws when a node-scoped entry does not create a leaf in file-based mode", () => {
    expect(() =>
      build(["server/routes/_middleware.ts"], {
        profile: "file-based",
        root: "server/routes",
        defineEntry() {
          return { kind: "middleware" };
        },
        isRouteFile() {
          return false;
        },
      }),
    ).toThrow('Node-scoped entry "_middleware.ts" must also be a route file in file-based mode.');
  });
});
