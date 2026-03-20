# fs-route-ir

[English](./README.md) | 简体中文

`fs-route-ir` 是一个把文件路径解析成路由树的底层包。
这里的 `fs` 指 `file-style path shape`，表示它使用文件路径风格的输入约定，但不要求真实文件系统。

它只负责三件事：

- 把文件路径解析成统一的 segment / pattern 表达
- 构建路由树和路径索引
- 把文件归类为挂在节点上的 `entries`

它不负责模块执行、请求方法匹配、运行时调度，也不内建任何特定框架的文件语义。

## 核心设计

这个包只提供底层能力：

- `directory-based`：目录形成路由节点，文件挂为节点 `entries`
- `file-based`：文件形成路由叶子，目录只负责层级和目录级 `entries`

统一模型是：

- `RouteNode`：路径节点
- `RouteEntry`：挂在节点上的文件
- `meta`：调用方扩展数据

这样上层可以把自己的文件约定映射到 runtime，而不是写死在 core 里。

## 支持的 segment

- `blog`
- `[slug]`
- `[...slug]`
- `[[...slug]]`
- `(group)`

不支持：

- `[[slug]]`
- `[slug]+`
- `prefix-[slug]-suffix`

## API

```ts
import { build, createMatcher, parsePath, walkTree } from "fs-route-ir";
```

## 快速开始

```ts
import { build, createMatcher } from "fs-route-ir";

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

把相对路径解析成统一结构：

```ts
parsePath("blog/[slug]/view.vue", {
  profile: "file-based",
  root: "app/routes",
});
```

返回值包含：

- `segments`
- `pattern`，例如 `/blog/:slug/view`
- `signature`，用于冲突检测

如果你不想用默认的 `:name` 形式，可以传 `formatParam()`：

```ts
parsePath("blog/[slug]/view.vue", {
  profile: "file-based",
  root: "app/routes",
  formatParam(param) {
    return param.kind === "one" ? `{${param.name}}` : `{...${param.name}}`;
  },
});
```

这样得到的 `pattern` 会是 `/blog/{slug}/view`，但 `signature` 仍然保持结构化冲突检测格式。

### `build()`

从文件列表构建路由树：

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

返回 `BuildResult`：

- `tree`：完整路由树
- `pathIndex`：`signature -> node id`
- `dirFiles`：目录到直接文件列表的映射

`directory-based` 最适合“目录定义节点，文件挂到节点上”的模型：

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

只做路径匹配：

```ts
const matchPath = createMatcher(result);
const match = matchPath("/blog/hello");
```

匹配结果包含：

- `params`
- `nodes`：从 root 到 leaf 的完整分支
- `leaf`
- `entries`：整条分支上的全部 entry

请求方法筛选、entry 调度和执行顺序由调用方自己决定。

```ts
const matchPath = createMatcher(result);
const match = matchPath("/blog/hello");

console.log(match?.leaf.pattern);
// "/blog/:slug"
```

### `walkTree()`

用于遍历构建结果：

```ts
walkTree(result, (node, depth, parent) => {
  console.log(depth, parent?.id, node.id);
});
```

输出类似：

```text
0 undefined dir:
1 dir: dir:users
2 dir:users users/[id]
```

如果 visitor 明确返回 `false`，遍历会立刻中断：

```ts
walkTree(result, (node) => {
  if (node.id === "users/[id]") {
    return false;
  }
});
```

## 示例

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

这里：

- `""`、`blog`、`blog/[slug]` 都会成为 `RouteNode`
- `shell.ts`、`view.vue`、`data.ts` 会作为 `entries` 挂到对应节点

### `file-based`

```text
server/routes/
├── api/
│  ├── _guard.ts
│  └── users/
│     └── [id].ts
└── robots.txt.ts
```

这里：

- `users/[id].ts`、`robots.txt.ts` 可以形成路由 leaf
- `_guard.ts` 可以被归类为目录级 entry
- `isRouteFile()` 只决定哪些文件产生 leaf

## 约束

- 同一个 `signature` 不能对应多个节点，否则直接抛错
- `file-based` 中，`scope: "node"` 的 entry 必须同时是 route file，否则直接抛错
- matcher 只关心路径，不关心 HTTP method

## 开发

```bash
pnpm --filter fs-route-ir build
```

更完整的设计讨论见 [design.md](./design.md)。
