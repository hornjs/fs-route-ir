import { describe, expect, it } from "vitest";

import * as routing from "../src/index.ts";

describe("public entry", () => {
  it("exports the runtime API", () => {
    expect(routing).toMatchObject({
      build: expect.any(Function),
      createMatcher: expect.any(Function),
      parsePath: expect.any(Function),
      walkTree: expect.any(Function),
    });
  });
});
