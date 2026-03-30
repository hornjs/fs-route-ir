# fs-route-ir 设计草稿

## 定位

`fs-route-ir` 是一个把文件路径解析成路由树的底层包，支持基于目录和基于文件两种建模方式。
这里的 `fs` 指 `file-style path shape`，强调输入遵循文件路径风格，而不是要求实际读取文件系统。

这层能力的目标很单一：

- 把文件风格路径解析成稳定、可比较的路径结构
- 把结构节点和挂载其上的 entry 统一收敛到一个中间表示
- 为上层 adapter 保留足够扩展空间，而不提前绑定任何框架语义

## 设计原则

### 1. 路径结构与运行时语义分离

核心层只处理“路径是什么”和“文件被归到哪里”，不处理“模块如何执行”。
请求方法、运行时调度、entry 执行顺序、错误边界语义等，都属于上层 adapter 的职责。

### 2. 同一套 IR 同时服务两种 profile

`directory-based` 和 `file-based` 共享同一套 segment 语法、节点结构和构建结果。
二者的差异主要体现在“什么形成节点”和“entry 挂在哪里”，而不是拆成两套完全独立的数据模型。

### 3. 路径节点与 entry 文件分开表达

`RouteNode` 表达路径结构，`RouteEntry` 表达挂载在节点上的文件。
这样可以避免把“路径是否存在”与“该路径上有哪些文件语义”混在一起，也让 adapter 更容易在上层自由解释这些 entry。

### 4. 模型优先保证单义和可比较

路径解析的结果必须稳定、可比较、可做冲突检测。
因此内部会同时保留：

- 面向外部展示的 `pattern`
- 面向冲突检测的 `signature`
- 面向进一步消费的 `segments` 与 `params`

### 5. 复杂度为当前目标服务

支持的语法应当能够被当前模型自然表达。
如果某种语法会显著增加状态空间或引入一个节点对应多个路径变体的情况，就不应在这个阶段进入核心层。

## 核心职责

`fs-route-ir` 负责以下事情：

1. 解析目录或文件路径，得到统一的 segment 表达。
2. 构建树结构、父子关系和路径索引。
3. 把文件归类为挂载在节点上的 route entries。
4. 为调用方保留 `meta` 扩展槽位。
5. 提供只做路径命中的 matcher。

## 非目标

下面这些能力不属于 `routing` 核心层的职责范围，而应交给上层 adapter 或用户自定义扩展：

- 任何带有框架语义的特殊文件或特殊目录约定
- 应用级配置、全局钩子或初始化入口
- 全局错误边界、全局数据加载或全局中间件组织方式
- entry 对应模块的导出约定
- entry 在运行时的执行顺序、触发时机和组合方式

换句话说，`routing` 可以识别哪些文件应该作为 entry 进入路由结果，但不会赋予这些 entry 具体框架语义，也不会决定它们在 runtime 中如何执行。

## Profile

保留两个 profile：

- `directory-based`
- `file-based`

二者共享 segment 语法，但“什么形成节点”和“哪些文件会挂成 entry”不同。

### `directory-based`

- 目录形成节点
- 目录名提供 route segments
- group 目录仍然参与文件系统层级，但不会进入 URL
- 节点上的文件被归类为该节点的 entries

这种模式适合“目录定义路径，文件补充节点能力”的框架模型。

### `file-based`

- 文件形成 route leaf
- 路径由目录名和文件名共同决定
- 末尾文件名是 `index` 时，映射到当前目录根路径
- group 目录不进入 URL
- 所有文件都可以先参与 `defineEntry()`
- 只有通过 `isRouteFile()` 的文件才会生成 leaf 节点

这种模式适合“文件本身就是最终路由单元”的框架模型。

## Segment 语法

支持的最小集合如下：

| 类型              | 示例          | 说明                        |
| ----------------- | ------------- | --------------------------- |
| static            | `blog`        | 静态 segment                |
| dynamic           | `[slug]`      | 单段参数                    |
| catchall          | `[...slug]`   | 一到多段参数                |
| optional-catchall | `[[...slug]]` | 零到多段参数                |
| group             | `(marketing)` | 对 URL 透明，仅用于文件组织 |

暂不支持：

- `[[slug]]`
- `[slug]+`
- `[[slug]]+`
- `prefix-[slug]-suffix`

原因很直接：这些语法会把“一个节点一个确定 pattern”的模型升级成多变体模型，而当前阶段没有足够理由为它们扩展这部分复杂性。`[[...slug]]` 是例外，因为它仍然可以在现有模型里被表示为一个节点，只是在匹配阶段允许零段消费。

## Path 表达原则

每条输入路径在解析后都会得到几种不同层次的表示，它们承担不同职责：

- `segments`：保留原始结构信息，供构建树和匹配使用
- `pattern`：面向外部展示的归一化 URL 形态
- `signature`：忽略参数名后的结构签名，用于冲突检测
- `params`：参数列表及其是否可选等元信息

例如：

- `blog` 对应 `/blog`
- `[slug]` 对应 `/:slug`
- `[...slug]` 对应 `/*`
- `(marketing)/about` 对应 `/about`

`signature` 会主动抹掉参数名，因此 `/users/:id` 和 `/users/:slug` 会被视为同一路径结构。

如果调用方需要 `{name}` 之类的外部格式，可以通过 `formatParam` 自定义 `pattern` 的展示形式；但这种自定义不应影响内部 `signature` 规则。

## 树与 entry 模型

虽然实现里有若干具体类型，但从设计上可以把它们理解为四个核心概念：

### 1. 路径树

路径树表达结构关系，只回答“有哪些节点”和“它们如何相连”。

### 2. 路径节点

每个节点都应当具备这些稳定信息：

- 一个稳定 `id`
- 当前节点所在目录 `dir`
- 当前节点对应的公共 `pattern`
- 用于匹配和排序的 `segments`
- 挂在当前节点上的 `entries`
- 子节点列表 `children`
- 可选的扩展 `meta`

### 3. 路由 entry

entry 是挂在节点上的文件，而不是路径本身。
它至少需要表达：

- 调用方定义的 `kind`
- 文件路径
- 挂载范围 `scope`

其中：

- `scope: "node"` 表示挂到具体节点或 leaf
- `scope: "directory"` 表示挂到目录容器节点

### 4. 构建结果

构建结果除了完整树结构，还会保留两份辅助信息：

- `pathIndex`：从结构签名到 routable node id 的映射
- `dirFiles`：目录到直接文件列表的映射

`dirFiles` 的存在是为了让核心层不解释辅助文件，但上层仍然可以基于目录内文件做额外推导。

## entry 分类原则

`routing` 核心层不内建固定的 entry kind 集合，而是要求调用方显式提供分类规则。

这样做的原因是：

- 不同框架对同名文件的含义并不一致
- 某些文件只在特定 runtime 中才有意义
- 核心层只需要知道“这是不是一个 entry”，不需要知道“这个 entry 最终做什么”

因此，进入路由系统的辅助文件应被视为 route entry，而不是塞进黑盒 `meta`。

## Matcher 设计原理

matcher 只负责 path match，不负责请求方法、执行优先级或最终调度。

它的职责可以概括为两步：

1. 根据 URL path 命中一条节点分支。
2. 返回这条分支上的节点、leaf、参数和 entries。

这样设计有几个明确好处：

- 请求方法通常不是从文件路径直接推导出来的
- 不同框架对 entry 的执行顺序和筛选策略不同
- 核心层只做路径命中，边界更稳定，也更容易复用

匹配结果从设计上至少需要包含：

- `params`
- `nodes`，也就是从 root 到 leaf 的完整分支
- `leaf`
- `entries`

其中 `entries` 不是单个文件，而是整条命中分支贡献出来的 entry 集合。

## 公开 API 组织

当前 API 组织遵循“结构能力”和“匹配能力”分开的思路：

- 根入口 `fs-route-ir` 提供 `parsePath`、`build`、`walkTree` 以及结构相关类型
- 子入口 `fs-route-ir/matcher` 提供 `createMatcher` 以及 matcher 相关类型

这意味着：

- 树构建和路径解析是默认公开能力
- matcher 是并列但独立的能力，不强制绑定在根入口上

从职责上看：

- `parsePath` 负责解析单条路径
- `build` 负责从文件列表构建整体树
- `walkTree` 负责深度优先遍历结果树，visitor 返回 `false` 时可提前停止
- `createMatcher` 负责基于构建结果创建 path-only matcher

## 校验与约束

### 通用约束

- segment 命名非法时直接报错
- group segment 不进入 URL pattern
- 同一路径签名的冲突必须被检测出来

### `directory-based` 约束

- 一个目录只生成一个 `RouteNode`
- entry 挂在目录节点上，而不是单独形成路径节点
- 目录是否“可执行”由上层语义决定；核心层只负责提供路径节点和挂载其上的 entries

### `file-based` 约束

- 同一路径签名不允许多个 leaf 节点
- `index` 只在 `file-based` 下有特殊含义
- `defineEntry()` 可以识别 route file 和辅助文件
- `isRouteFile()` 只决定哪些文件参与 leaf 路径构建
- 被 `defineEntry()` 识别出的 entry 应挂到对应节点上
- `scope: "node"` 的 entry 如果不产生 leaf，应直接报错

## 示例理解

### `directory-based`

可以把它理解成：

- 每一级目录先形成路径节点
- 同目录下的文件再被归类为该节点的 entries
- group 目录保留组织能力，但不会进入 URL

因此，一个像 `blog/[slug]` 这样的目录路径，会成为节点；而其中的 `view`、`data`、`fallback` 等文件，会成为挂在这个节点上的不同 entry。

### `file-based`

可以把它理解成：

- 目录先提供层级
- 最终 route leaf 由文件本身决定
- 辅助文件是否参与 leaf 生成，由 `isRouteFile()` 决定
- 辅助文件是否作为 entry 保留，由 `defineEntry()` 决定

因此，像 `_guard.ts` 这样的文件可以被识别为 entry，但不一定形成叶子；而 `ping.ts`、`users/[id].ts` 这类文件则会形成真正的 route leaf。

## 结论

这个设计的核心目标非常明确：

把 `directory-based` 和 `file-based` 收敛成一个“路径解析 + 树构建 + entry 归类 + meta 扩展槽”的底层能力。

调用方自己的文件约定，可以通过 adapter 的 `defineEntry()` 映射到 `entries`；但这些 entry 的执行语义、调度策略和框架含义，仍然应该由上层 adapter 负责。
