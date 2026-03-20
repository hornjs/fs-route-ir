# fs-route-ir 设计草稿

## 定位

`fs-route-ir` 是一个把文件路径解析成路由树的底层包，支持基于目录和基于文件两种建模方式。
这里的 `fs` 指 `file-style path shape`，表示输入遵循文件路径风格，而不是要求实际读取文件系统。

它只负责：

1. 解析目录 / 文件路径到统一的 segment 表达。
2. 构建树、父子关系和路径索引。
3. 归类挂载在节点上的 route entries。
4. 为上层保留 `meta` 扩展槽位。

它不负责：

- 读取模块导出
- 生成上层框架的 runtime manifest
- 执行冲突策略以外的框架语义

这层关心“路径结构”和“节点上的 entry 归类”，但不关心这些 entry 在运行时如何执行。

## 非目标

下面这些都属于上层 adapter 或用户扩展逻辑，不属于 `routing` 内建语义：

- 应用级特殊入口文件
- 全局错误处理文件
- 全局数据加载文件
- 应用配置文件
- 全局中间件目录
- entry 的模块导出语义
- entry 的执行时机和组合方式

`routing` 会识别 entry，但不会解释这些 entry 在具体 runtime 中如何工作。

## Profile

保留两个 profile：

- `directory-based`
- `file-based`

二者共享 segment 语法，但“什么形成节点”和“有哪些 entry kind”不同：

- `directory-based`：目录形成节点
- `file-based`：文件形成叶子

## Segment 语法

支持的最小集合：

| 类型     | 示例          | 说明                        |
| -------- | ------------- | --------------------------- |
| static   | `blog`        | 静态 segment                |
| dynamic  | `[slug]`      | 单段参数                    |
| catchall | `[...slug]`   | 一到多段参数                |
| catchall | `[[...slug]]` | 零到多段参数                |
| group    | `(marketing)` | 对 URL 透明，仅用于文件组织 |

不支持：

- `[[slug]]`
- `[slug]+`
- `[[slug]]+`
- `prefix-[slug]-suffix`

原因很直接：这些语法会把“一个节点一个确定 pattern”的模型升级成多变体模型，复杂度目前不值得引入。`[[...slug]]` 例外，它可以在现有单节点模型里按“可选 catchall”实现。

## Path 规范

解析后统一产出一个可比较的 pattern：

- `blog` -> `/blog`
- `[slug]` -> `/:slug`
- `[...slug]` -> `/*`
- `(marketing)/about` -> `/about`

同时产出一个忽略参数名的 `signature`，用于冲突检测：

- `/users/:id`
- `/users/:slug`

这两个 pattern 的 `signature` 相同，应视为歧义冲突。

`pattern` 默认使用 `:name` 表示单段参数，使用 `*` 表示 catchall。
如果调用方需要 `{name}` 等其它风格，应该通过参数格式化函数自定义输出，而不是影响内部 `signature` 规则。

## 节点模型

`routing` 统一产出一棵 `RouteTree`。

但两种 profile 对“节点来源”的解释不同：

### `directory-based`

- 目录形成节点
- 只有包含至少一个未忽略文件的目录，才会生成节点
- 目录名负责提供 route segments
- group 目录仍然参与文件系统层级，但不会进入 URL
- 节点下可以挂多个 route entries

### `file-based`

- 文件形成 route leaf
- 路径由目录名 + 文件名共同决定
- 末尾文件名是 `index` 时，映射到当前目录根路径
- group 目录不进入 URL
- 所有文件都可以先参与 `defineEntry()`
- 只有通过 `isRouteFile()` 的文件才会生成 leaf 节点
- leaf 节点通常只有一个主 entry

换句话说，同一个 `RouteNode` 结构会同时承载：

- `directory-based` 的目录节点
- `file-based` 的中间结构节点和最终叶子节点

因此“路径节点”和“entry 文件”应该拆开表达。

## 数据模型

```ts
type RouteProfile = "directory-based" | "file-based";

type SegmentToken =
  | { type: "static"; value: string }
  | { type: "dynamic"; name: string }
  | { type: "catchall"; name: string }
  | { type: "group"; name: string };

interface ParsedPath {
  input: string;
  profile: RouteProfile;
  segments: SegmentToken[];
  pattern: string;
  signature: string;
  params: Array<{
    name: string;
    kind: "one" | "many";
  }>;
}
```

```ts
type RouteTree<TMeta = unknown, TEntryKind extends string = string> = {
  profile: RouteProfile;
  nodes: RouteNode<TMeta, TEntryKind>[];
};

type RouteNode<TMeta = unknown, TEntryKind extends string = string> = {
  id: string; // 稳定标识，通常是相对路径
  dir: string; // 当前节点所在目录
  pattern: string; // 归一化后的 URL pattern
  segments: SegmentToken[];
  entries: RouteEntry<TEntryKind>[];
  meta?: TMeta;
  children: RouteNode<TMeta, TEntryKind>[];
};

type RouteEntry<TEntryKind extends string = string> = {
  kind: TEntryKind;
  file: string;
  scope: "node" | "directory";
};
```

字段说明：

- `id` 是节点的稳定标识，通常使用相对路径
- `pattern` 是归一化后的 URL pattern
- `entries` 表达挂载在当前节点上的所有路由相关文件
- `meta` 只用于用户扩展，不负责承载核心 entry 语义

对于 `file-based`，中间结构节点可以只有 `children`，没有任何 `entries`。

### entry kind

`routing` core 不内建固定 kind 集合，但 profile adapter 应该显式提供分类规则。

例如调用方可以在上层做 adapter，定义自己的 entry kind 集合。

需要进入路由系统的辅助文件，应该被视为 route entry，而不是黑盒 `meta`。

### 构建结果

```ts
interface BuildResult<TMeta = unknown, TEntryKind extends string = string> {
  tree: RouteTree<TMeta, TEntryKind>;
  pathIndex: Map<string, string>; // signature -> node id
  dirFiles: Map<string, string[]>; // 目录 -> 直接文件列表
}
```

`dirFiles` 仍然保留，这样 core 不解释 sidecar 文件，但上层仍可根据目录文件做扩展。

## Matcher

matcher 只负责 path match，不负责请求方法、执行优先级或最终调度。

它的职责很单一：

1. 根据 URL path 命中一条节点分支
2. 返回这条分支上的全部节点和可见 entries

至于这些 entries 里哪些能处理 `GET` / `POST` / `PUT`，应该由调用方自己决定。

这样做的原因是：

- 请求方法通常不是从文件路径直接推导出来的
- 不同框架对 entry 的执行顺序和筛选策略不同
- core 只做路径命中，边界最稳定

### 匹配结果

```ts
interface PathMatch<TMeta = unknown, TEntryKind extends string = string> {
  params: Record<string, string>;
  nodes: RouteNode<TMeta, TEntryKind>[]; // root -> leaf
  leaf: RouteNode<TMeta, TEntryKind>;
  entries: MatchedEntry<TMeta, TEntryKind>[];
}

interface MatchedEntry<TMeta = unknown, TEntryKind extends string = string> {
  node: RouteNode<TMeta, TEntryKind>;
  entry: RouteEntry<TEntryKind>;
}

type RouteMatcher<TMeta = unknown, TEntryKind extends string = string> = (
  path: string,
) => PathMatch<TMeta, TEntryKind> | null;
```

### 匹配规则

- 先按 path 命中一条节点分支
- `directory-based` 返回整条分支，方便上层消费节点链路上的各类 entries
- `file-based` 的最终可执行节点通常是 leaf，但中间节点仍然保留在 `nodes` 里
- 返回整条分支上的全部 entries
- entries 的可执行性、方法过滤、优先级排序全部交给调用方

## API 草案

```ts
function parsePath(
  input: string,
  options: {
    profile: RouteProfile;
    root?: string;
    formatParam?: (param: {
      name: string;
      kind: "one" | "many";
      optional?: boolean;
    }) => string;
  },
): ParsedPath;

function build<TMeta = unknown, TEntryKind extends string = string>(
  files: string[],
  options: {
    profile: RouteProfile;
    root: string;
    formatParam?: (param: {
      name: string;
      kind: "one" | "many";
      optional?: boolean;
    }) => string;
    ignore?: (entry: string, kind: "file" | "dir") => boolean;
    defineEntry: (ctx: {
      profile: RouteProfile;
      file: string;
      dir: string;
      baseName: string;
    }) => { kind: TEntryKind; scope?: "node" | "directory" } | null;
    isRouteFile?: (file: string) => boolean; // 仅 file-based 使用，决定是否生成 leaf
    createMeta?: (ctx: {
      id: string;
      dir: string;
      parsed: ParsedPath;
      entries: RouteEntry<TEntryKind>[];
      files: string[];
      isLeaf: boolean;
    }) => TMeta;
  },
): BuildResult<TMeta, TEntryKind>;

function walkTree(
  result: BuildResult,
  visitor: (node: RouteNode, depth: number, parent: RouteNode | null) => void,
): void;

function createMatcher<TMeta = unknown, TEntryKind extends string = string>(
  result: BuildResult<TMeta, TEntryKind>,
): RouteMatcher<TMeta, TEntryKind>;
```

## 校验规则

### 通用

- segment 命名非法时直接报错
- group segment 不进入 URL pattern
- 同一路径签名的冲突要能被检测出来

### `directory-based`

- 一个目录只生成一个 `RouteNode`
- entry 挂在目录节点上，而不是单独形成路径节点
- 各类需要挂在节点上的辅助文件如果存在，应进入 `entries`
- 是否把某个节点视为“真实路由节点”是上层语义，不在 core 决定

### `file-based`

- 同一路径签名不允许多个 leaf 节点
- `index` 只在 profile 为 `file-based` 时有特殊含义
- `defineEntry()` 可以识别 route file 和 sidecar file
- `isRouteFile()` 只决定哪些文件参与 leaf 路径构建
- 被 `defineEntry()` 识别出的 entry 应挂到对应节点上
- `scope: "node"` 的 entry 如果不产生 leaf，直接报错

## 示例

### `directory-based`

目录结构：

```text
app/routes/
├── shell.ts
├── view.vue
├── blog/
│  ├── _guard.ts
│  ├── shell.ts
│  ├── pending.vue
│  └── [slug]/
│     ├── view.vue
│     ├── fallback.vue
│     └── data.ts
└── (content)/
   └── about/
      └── view.vue
```

core 只会给出节点和 entries：

- 根目录节点 `""`，entries 可包含 `shell`、`view`
- `blog` 节点，entries 可包含 `directory-guard`、`shell`、`pending`
- `blog/[slug]` 节点，entries 可包含 `view`、`fallback`、`data`
- `(content)/about` 节点，pattern `/about`

至于这些 entry 在具体 runtime 中如何执行，由上层 adapter 决定。

### `file-based`

目录结构：

```text
server/routes/
├── api/
│  ├── _guard.ts
│  ├── ping.ts
│  └── users/
│     └── [id].ts
└── robots.txt.ts
```

如果调用方让 `defineEntry()` 识别 `_guard.ts`，但 `isRouteFile()` 不把它视为 route leaf，结果应包含：

- `/api/ping`
- `/api/users/:id`
- `/robots.txt`

同时 `defineEntry()` 可以把 `api/_guard.ts` 归类为 `directory-guard`，把 `ping.ts` 归类为 `endpoint`。

## 结论

目标非常单一：

把 `directory-based` 和 `file-based` 收敛成一个“路径解析 + 树构建 + entry 归类 + meta 扩展槽”的底层能力。

调用方自己的文件约定，可以通过 adapter 的 `defineEntry()` 映射到 `entries`；但这些 entry 的执行语义仍然应该由上层 adapter 负责。
