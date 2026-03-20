import { describe, expect, it } from "vitest";

import { parseSegment } from "../src/segments.ts";

describe("parseSegment", () => {
  it("parses supported segment kinds", () => {
    expect(parseSegment("blog")).toEqual({ type: "static", value: "blog" });
    expect(parseSegment("[slug]")).toEqual({ type: "dynamic", name: "slug" });
    expect(parseSegment("[...slug]")).toEqual({ type: "catchall", name: "slug" });
    expect(parseSegment("[[...slug]]")).toEqual({ type: "optional-catchall", name: "slug" });
    expect(parseSegment("(marketing)")).toEqual({ type: "group", name: "marketing" });
  });

  it("rejects unsupported segment syntax", () => {
    expect(() => parseSegment("[[slug]]")).toThrow('Unsupported route segment syntax "[[slug]]".');
  });

  it("rejects invalid parameter names", () => {
    expect(() => parseSegment("[slug.name]")).toThrow('Invalid route segment "[slug.name]".');
  });
});
