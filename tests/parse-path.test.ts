import { describe, expect, it } from "vitest";

import { parsePath } from "../src/parse-path.ts";

describe("parsePath", () => {
  it("parses directory-based paths and keeps group segments out of the pattern", () => {
    const parsed = parsePath("(marketing)/about", {
      profile: "directory-based",
    });

    expect(parsed.pattern).toBe("/about");
    expect(parsed.signature).toBe("/about");
    expect(parsed.segments).toEqual([
      { type: "group", name: "marketing" },
      { type: "static", value: "about" },
    ]);
    expect(parsed.params).toEqual([]);
  });

  it("parses file-based paths with root stripping and index normalization", () => {
    const parsed = parsePath("app/pages/blog/[slug]/index.vue", {
      profile: "file-based",
      root: "app/pages",
    });

    expect(parsed.input).toBe("app/pages/blog/[slug]/index.vue");
    expect(parsed.pattern).toBe("/blog/:slug");
    expect(parsed.signature).toBe("/blog/:");
    expect(parsed.params).toEqual([{ name: "slug", kind: "one" }]);
  });

  it("parses catchall params and removes parameter names from signatures", () => {
    const first = parsePath("users/[id].ts", {
      profile: "file-based",
    });
    const second = parsePath("users/[slug].ts", {
      profile: "file-based",
    });
    const catchall = parsePath("docs/[...parts].ts", {
      profile: "file-based",
    });

    expect(first.signature).toBe(second.signature);
    expect(catchall.pattern).toBe("/docs/*");
    expect(catchall.params).toEqual([{ name: "parts", kind: "many" }]);
  });

  it("supports custom parameter formatting without changing signatures", () => {
    const parsed = parsePath("users/[id]/[...parts].ts", {
      profile: "file-based",
      formatParam(param) {
        if (param.kind === "one") {
          return `{${param.name}}`;
        }

        return `{...${param.name}}`;
      },
    });

    expect(parsed.pattern).toBe("/users/{id}/{...parts}");
    expect(parsed.signature).toBe("/users/:/*");
  });

  it("parses optional catchall params without introducing a new signature shape", () => {
    const required = parsePath("docs/[...parts].ts", {
      profile: "file-based",
    });
    const optional = parsePath("docs/[[...parts]].ts", {
      profile: "file-based",
    });

    expect(optional.pattern).toBe("/docs/*");
    expect(optional.signature).toBe(required.signature);
    expect(optional.params).toEqual([{ name: "parts", kind: "many", optional: true }]);
  });

  it("maps the root index file to the root pattern", () => {
    expect(
      parsePath("index.ts", {
        profile: "file-based",
      }),
    ).toMatchObject({
      pattern: "/",
      signature: "/",
      segments: [],
    });
  });
});
