import { readFileSync } from "node:fs";

import { describe, expect, expectTypeOf, it } from "vitest";

import { build } from "../src/build.ts";
import type { RouteEntry, RouteNode } from "../src/types.ts";
import * as matcher from "../src/matcher.ts";
import { createMatcher } from "../src/matcher.ts";
import type { MatchedEntry, PathMatch, RouteMatcher } from "../src/matcher.ts";

function defineEntry({ baseName }: { baseName: string }) {
  if (baseName === "layout" || baseName === "page") {
    return { kind: baseName };
  }

  return null;
}

describe("matcher entry", () => {
  it("exports the matcher API from the dedicated entry", () => {
    expect(matcher).toMatchObject({
      createMatcher: expect.any(Function),
    });
  });

  it("exports matcher-related types from the dedicated entry", () => {
    expectTypeOf<MatchedEntry<{ secure: boolean }, "page">>().toEqualTypeOf<{
      node: RouteNode<{ secure: boolean }, "page">;
      entry: RouteEntry<"page">;
    }>();
    expectTypeOf<PathMatch<{ secure: boolean }, "page">["entries"]>().toEqualTypeOf<
      Array<MatchedEntry<{ secure: boolean }, "page">>
    >();
    expectTypeOf<RouteMatcher<{ secure: boolean }, "page">>().toEqualTypeOf<
      (path: string) => PathMatch<{ secure: boolean }, "page"> | null
    >();
  });

  it("declares the matcher subpath export", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      exports?: Record<string, string>;
    };

    expect(packageJson.exports?.["./matcher"]).toBe("./src/matcher.ts");
  });
});

describe("createMatcher", () => {
  it("prefers static routes over dynamic routes", () => {
    const result = build(["app/pages/docs/page.vue", "app/pages/[slug]/page.vue"], {
      profile: "directory-based",
      root: "app/pages",
      defineEntry,
    });

    const matchPath = createMatcher(result);

    expect(matchPath("/docs")?.leaf.id).toBe("docs");
  });

  it("prefers dynamic routes over catchall routes and keeps branch entries", () => {
    const result = build(
      [
        "app/pages/layout.ts",
        "app/pages/blog/page.vue",
        "app/pages/blog/[slug]/page.vue",
        "app/pages/blog/[...slug]/page.vue",
      ],
      {
        profile: "directory-based",
        root: "app/pages",
        defineEntry,
      },
    );

    const matchPath = createMatcher(result);
    const match = matchPath("/blog/hello");

    expect(match).toMatchObject({
      params: { slug: "hello" },
      leaf: { id: "blog/[slug]" },
      nodes: [{ id: "" }, { id: "blog" }, { id: "blog/[slug]" }],
    });
    expect(match?.entries.map((item) => `${item.node.id}:${item.entry.kind}`)).toEqual([
      ":layout",
      "blog:page",
      "blog/[slug]:page",
    ]);
  });

  it("matches catchall routes with slash-joined params", () => {
    const result = build(["app/pages/blog/[...slug]/page.vue"], {
      profile: "directory-based",
      root: "app/pages",
      defineEntry,
    });

    const matchPath = createMatcher(result);
    const match = matchPath("/blog/a/b");

    expect(match).toMatchObject({
      params: { slug: "a/b" },
      leaf: { id: "blog/[...slug]" },
    });
  });

  it("matches optional catchall routes with or without extra segments", () => {
    const result = build(["server/routes/docs/[[...slug]].ts"], {
      profile: "file-based",
      root: "server/routes",
      defineEntry() {
        return { kind: "route" };
      },
    });

    const matchPath = createMatcher(result);

    expect(matchPath("/docs")).toMatchObject({
      params: {},
      leaf: { id: "docs/[[...slug]]" },
    });
    expect(matchPath("/docs/a/b")).toMatchObject({
      params: { slug: "a/b" },
      leaf: { id: "docs/[[...slug]]" },
    });
  });

  it("prefers a concrete route over an optional catchall fallback", () => {
    const result = build(["app/pages/docs/page.vue", "app/pages/docs/[[...slug]]/page.vue"], {
      profile: "directory-based",
      root: "app/pages",
      defineEntry,
    });

    const matchPath = createMatcher(result);

    expect(matchPath("/docs")?.leaf.id).toBe("docs");
  });

  it("returns null when no route matches", () => {
    const result = build(["app/pages/docs/page.vue"], {
      profile: "directory-based",
      root: "app/pages",
      defineEntry,
    });

    const matchPath = createMatcher(result);

    expect(matchPath("/missing")).toBeNull();
  });
});
