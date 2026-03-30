# fs-route-ir

English | [简体中文](./README.zh-CN.md)

`fs-route-ir` is a low-level package that parses file paths into a route tree.
Here `fs` means `file-style path shape`: it uses file-path-like input conventions, but it does not require a real filesystem.

It does only three things:

- parses file paths into normalized segments and patterns
- builds a route tree and path index
- turns files into `entries` attached to nodes

It does not handle module execution, HTTP method matching, runtime dispatch, or any framework-specific file semantics.

## Design

This package provides only the core layer:

- `directory-based`: directories become route nodes, files become node `entries`
- `file-based`: files become route leaves, directories preserve hierarchy and directory-scoped `entries`

The unified model is:

- `RouteNode`: a path node
- `RouteEntry`: a file attached to a node
- `meta`: caller-defined extension data

This keeps runtime semantics outside the core. Callers can map their own file conventions onto these primitives.

## Supported Segments

- `blog`
- `[slug]`
- `[...slug]`
- `[[...slug]]`
- `(group)`

Not supported:

- `[[slug]]`
- `[slug]+`
- `prefix-[slug]-suffix`

## API

```ts
import { build, parsePath, walkTree } from "fs-route-ir";
import { createMatcher } from "fs-route-ir/matcher";
```

## Quick Start

```ts
import { build } from "fs-route-ir";
import { createMatcher } from "fs-route-ir/matcher";

const result = build(
  [
    "server/routes/_guard.ts",
    "server/routes/users/[id].ts",
    "server/routes/robots.txt.ts",
  ],
  {
    profile: "file-based",
    root: "server/routes",
    formatParam(param) {
      return param.kind === "one" ? `{${param.name}}` : `{...${param.name}}`;
    },
    defineEntry({ baseName }) {
      if (baseName === "_guard") {
        return { kind: "directory-guard", scope: "directory" };
      }

      return { kind: "endpoint" };
    },
    isRouteFile(file) {
      return !file.endsWith("_guard.ts");
    },
  },
);

const matchPath = createMatcher(result);
const match = matchPath("/users/42");

console.log(match?.leaf.id);
// "users/[id]"

console.log(match?.params);
// { id: "42" }

console.log(match?.entries.map((item) => item.entry.kind));
// ["directory-guard", "endpoint"]
```

### `parsePath()`

Parses a relative path into a normalized structure:

```ts
parsePath("blog/[slug]/view.vue", {
  profile: "file-based",
  root: "app/routes",
});
```

The return value includes:

- `segments`
- `pattern`, for example `/blog/:slug/view`
- `signature`, used for conflict detection

If you do not want the default `:name` style, pass `formatParam()`:

```ts
parsePath("blog/[slug]/view.vue", {
  profile: "file-based",
  root: "app/routes",
  formatParam(param) {
    return param.kind === "one" ? `{${param.name}}` : `{...${param.name}}`;
  },
});
```

This produces `/blog/{slug}/view` as the `pattern`, while `signature` stays structural for ambiguity checks.

### `build()`

Builds a route tree from a list of files:

```ts
const result = build(files, {
  profile: "directory-based",
  root: "app/routes",
  defineEntry({ baseName }) {
    if (baseName === "view") return { kind: "view" };
    if (baseName === "shell") return { kind: "shell" };
    if (baseName === "_guard") return { kind: "directory-guard", scope: "directory" };
    return null;
  },
});
```

`BuildResult` includes:

- `tree`: the full route tree
- `pathIndex`: `signature -> node id`
- `dirFiles`: direct file listing per directory

`directory-based` fits models where directories define nodes and files attach to those nodes:

```ts
const result = build(
  ["app/routes/shell.ts", "app/routes/blog/[slug]/view.vue"],
  {
    profile: "directory-based",
    root: "app/routes",
    formatParam(param) {
      return `{${param.name}}`;
    },
    defineEntry({ baseName }) {
      if (baseName === "shell") return { kind: "shell" };
      if (baseName === "view") return { kind: "view" };
      return null;
    },
  },
);
```

### `createMatcher()`

Matches only by path:

```ts
import { createMatcher } from "fs-route-ir/matcher";

const matchPath = createMatcher(result);
const match = matchPath("/blog/hello");
```

The match result includes:

- `params`
- `nodes`: the full branch from root to leaf
- `leaf`
- `entries`: all entries contributed by that branch

HTTP method filtering, dispatch order, and runtime behavior are left to the caller.

```ts
import { createMatcher } from "fs-route-ir/matcher";

const matchPath = createMatcher(result);
const match = matchPath("/blog/hello");

console.log(match?.leaf.pattern);
// "/blog/:slug"
```

### `walkTree()`

Traverses the built tree:

```ts
walkTree(result, (node, depth, parent) => {
  console.log(depth, parent?.id, node.id);
});
```

Typical output:

```text
0 undefined dir:
1 dir: dir:users
2 dir:users users/[id]
```

If the visitor explicitly returns `false`, traversal stops immediately:

```ts
walkTree(result, (node) => {
  if (node.id === "users/[id]") {
    return false;
  }
});
```

## Examples

### `directory-based`

```text
app/routes/
├── shell.ts
├── view.vue
└── blog/
   ├── shell.ts
   └── [slug]/
      ├── view.vue
      └── data.ts
```

In this model:

- `""`, `blog`, and `blog/[slug]` all become `RouteNode`
- `shell.ts`, `view.vue`, and `data.ts` become `entries` attached to those nodes

### `file-based`

```text
server/routes/
├── api/
│  ├── _guard.ts
│  └── users/
│     └── [id].ts
└── robots.txt.ts
```

In this model:

- `users/[id].ts` and `robots.txt.ts` can become route leaves
- `_guard.ts` can be treated as a directory-scoped entry
- `isRouteFile()` decides which files produce leaves

## Constraints

- the same `signature` cannot map to multiple nodes
- in `file-based`, a `scope: "node"` entry must also be a route file
- the matcher only cares about path, not HTTP method

## Development

```bash
pnpm --filter fs-route-ir build
```

See [design.md](./design.md) for more design details.
