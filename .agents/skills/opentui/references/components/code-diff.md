# Code & Diff Components

Components for source code, line-number gutters, unified diffs, Markdown, and
text tables.

## Code Component

`CodeRenderable` displays plain text immediately and applies asynchronous
Tree-sitter highlighting when `filetype` and a parser are available.

### Basic Usage

```tsx
// React / Solid
<code content={sourceCode} filetype="typescript" syntaxStyle={syntaxStyle} />

// Core
const code = new CodeRenderable(renderer, {
  content: sourceCode,
  filetype: "typescript",
  syntaxStyle,
  wrapMode: "none", // "none" | "char" | "word"
})
```

OpenTUI bundles parsers for JavaScript/JSX, TypeScript/TSX, Markdown,
Markdown-inline, and Zig. Other grammars require Tree-sitter asset
configuration. Without `filetype`, Code renders unhighlighted text.

### Highlight Hooks

`onHighlight` can replace the syntax ranges before styling. It receives
`SimpleHighlight[]` tuples and `{ content, filetype, syntaxStyle }`; return an
array or `undefined`, synchronously or asynchronously.

```tsx
<code
  content={sourceCode}
  filetype="typescript"
  syntaxStyle={syntaxStyle}
  onHighlight={(highlights, context) =>
    highlights.filter((highlight) => highlight[2] !== "comment")
  }
/>
```

`onChunks` runs afterward and can replace the resolved `TextChunk[]`. Its
context also includes `highlights`.

```tsx
import { detectLinks } from "@opentui/core"

<code
  content={markdown}
  filetype="markdown"
  syntaxStyle={syntaxStyle}
  onChunks={(chunks, context) => detectLinks(chunks, context)}
/>
```

`detectLinks` applies links for recognized Markdown/URL highlight scopes.

## TextTable Component

`TextTableRenderable` is Core-only. It displays styled chunk cells with borders,
wrapping, width fitting, and selection.

```typescript
import {
  TextTableRenderable,
  bold,
  fg,
  type TextChunk,
  type TextTableContent,
} from "@opentui/core"

const cell = (text: string): TextChunk[] => [{ __isChunk: true, text }]
const content: TextTableContent = [
  [[bold("Service")], [bold("Status")], [bold("Notes")]],
  [cell("api"), [fg("#00d4aa")("OK")], cell("latency 28ms")],
]

const table = new TextTableRenderable(renderer, {
  content,
  wrapMode: "word",
  columnWidthMode: "full",   // "content" | "full"
  columnFitter: "balanced",  // "proportional" | "balanced"
  cellPadding: 1,
  border: true,
  outerBorder: true,
  borderStyle: "rounded",
  selectable: true,
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `content` | `TextTableContent` | - | Rows of styled chunk cells |
| `wrapMode` | `none \| char \| word` | `none` | Cell wrapping |
| `columnWidthMode` | `content \| full` | `full` | Natural or available-width sizing |
| `columnFitter` | `proportional \| balanced` | `proportional` | Distribute constrained width |
| `cellPadding` | `number` | `0` | Horizontal cell padding |
| `border`, `outerBorder` | `boolean` | `true` | Inner and outer borders |
| `borderStyle` | `single \| double \| rounded \| heavy` | `single` | Border glyph set |
| `borderColor` | `ColorInput` | - | Border color |
| `selectable` | `boolean` | `false` | Participate in text selection |

`TextTableCellContent` is `TextChunk[] | null | undefined`. Each literal chunk
needs `__isChunk: true`; styled-text helpers such as `bold()` and `fg()` already
return valid chunks. `getSelectedText()` and `hasSelection()` expose selection;
vertical drags within one column retain columnar selection.

## Line Number Component

`LineNumberRenderable` is a gutter for another renderable that implements
`LineInfoProvider`; it does not accept source code itself.

```tsx
// React (use <line_number> in Solid)
<line-number
  ref={lineNumbersRef}
  fg="#6b7280"
  bg="#161b22"
  minWidth={3}
  paddingRight={1}
  lineNumberOffset={0}
>
  <code content={sourceCode} filetype="typescript" syntaxStyle={syntaxStyle} />
</line-number>
```

```typescript
// Core
const code = new CodeRenderable(renderer, {
  content: sourceCode,
  filetype: "typescript",
  syntaxStyle,
})
const lineNumbers = new LineNumberRenderable(renderer, {
  target: code,
  minWidth: 3,
  paddingRight: 1,
})
```

Use methods rather than nonexistent `diagnostics`, `addedLines`,
`removedLines`, or `highlightedLines` props:

```typescript
lineNumbers.setLineColor(4, "#1a4d1a")
lineNumbers.setLineSign(4, { after: " +", afterColor: "#22c55e" })
lineNumbers.highlightLines(9, 11, "#4d1a1a")
lineNumbers.clearHighlightLines(9, 11)
```

Other methods include `clearLineColor()`, `setLineColors()`,
`clearAllLineColors()`, `clearLineSign()`, `setLineSigns()`, and
`clearAllLineSigns()`. `lineNumberOffset` changes displayed numbering.

## Diff Component

`DiffRenderable` accepts a unified diff string. It does not compute a diff from
old and new source strings.

```tsx
// React / Solid
<diff
  diff={unifiedPatch}
  filetype="typescript"
  syntaxStyle={syntaxStyle}
  view="split"
  syncScroll
  showLineNumbers
/>

// Core
const diff = new DiffRenderable(renderer, {
  diff: unifiedPatch,
  filetype: "typescript",
  syntaxStyle,
  view: "unified",
})
```

### Options

| Option | Type / Default | Description |
|--------|----------------|-------------|
| `diff` | `string` | Unified patch input |
| `view` | `unified \| split` / `unified` | Display mode |
| `syncScroll` | `boolean` / `false` | Keep split panes aligned |
| `filetype` | `string` | Tree-sitter language |
| `syntaxStyle` | `SyntaxStyle` | Highlight style |
| `wrapMode` | `word \| char \| none` | Source wrapping |
| `conceal` | `boolean` / `false` | Conceal syntax tokens |
| `showLineNumbers` | `boolean` / `true` | Show line-number gutters |
| `addedBg`, `removedBg`, `contextBg` | `ColorInput` | Whole-line backgrounds |
| `addedContentBg`, `removedContentBg`, `contextContentBg` | `ColorInput` | Changed-content backgrounds |
| `addedLineNumberBg`, `removedLineNumberBg`, `lineNumberBg` | `ColorInput` | Gutter backgrounds |
| `addedSignColor`, `removedSignColor` | `ColorInput` | `+` and `-` colors |

Use `view`, not `mode`; use `addedBg`/`removedBg`/`contextBg`, not
`addedLineColor`/`removedLineColor`/`unchangedLineColor`. Context lines are
already encoded in the patch, so there is no `context` option. For multi-file
input, Diff currently displays only the first parsed file patch.

### Programmatic Line Highlighting

```typescript
diff.setLineColor(10, "#FFFF0030")
diff.clearLineColor(10)
diff.setLineColors(new Map([
  [5, "#FF000030"],
  [10, { bg: "#00FF0030", fg: "#FFFFFF" }],
]))
diff.highlightLines(20, 25, "#0000FF30")
diff.clearHighlightLines(20, 25)
diff.clearAllLineColors()
```

`getHunkRowOffsets()` returns display-row offsets for parsed hunks. Re-read it
after changing the patch, view, wrapping, or dimensions.

## Markdown Component

`MarkdownRenderable` parses Markdown into styled renderables. Pass a
`SyntaxStyle` for fenced code highlighting.

```tsx
<markdown
  content={markdownText}
  syntaxStyle={syntaxStyle}
  conceal
  concealCode={false}
  streaming={false}
  internalBlockMode="coalesced"
/>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `content` | `string` | `""` | Markdown source |
| `syntaxStyle` | `SyntaxStyle` | - | Syntax colors |
| `treeSitterClient` | `TreeSitterClient` | shared | Parser client |
| `conceal` | `boolean` | `true` | Hide Markdown markers |
| `concealCode` | `boolean` | `false` | Hide fenced-code markers |
| `streaming` | `boolean` | `false` | Optimize append-only content |
| `internalBlockMode` | `coalesced \| top-level` | `coalesced` | Internal block grouping |
| `tableOptions` | `MarkdownTableOptions` | - | Table layout and border options |

### Custom Node Rendering

`renderNode` receives `(token, context)`. Return a custom renderable,
`context.defaultRender()` for the built-in representation, or `null`/
`undefined` as appropriate.

```typescript
const markdown = new MarkdownRenderable(renderer, {
  content: "# Custom Heading",
  syntaxStyle,
  renderNode(token, context) {
    if (token.type === "heading") {
      return new TextRenderable(renderer, { content: `>> ${token.text} <<` })
    }
    return context.defaultRender()
  },
})
```

For fenced-code specialization, use `createMarkdownCodeBlockRenderer()` to
dispatch normalized filetypes to custom renderers while retaining the default
renderer for unmatched tokens.

### Streaming Markdown

```tsx
<markdown
  content={streamedContent}
  syntaxStyle={syntaxStyle}
  streaming={isStreaming}
  internalBlockMode="top-level"
/>
```

Keep `streaming` true while appending and set it false when complete so the
final parse can settle. `top-level` mode exposes stable top-level blocks, which
is useful for LLM output and incremental views.

## Gotchas

- React uses `<line-number>`; Solid uses `<line_number>`.
- Code uses `content` and `filetype`, not `code` and `language`.
- Diff uses one unified `diff` string and `view`, not old/new strings and
  `mode`.
- Line Number wraps a target; it does not render source code by itself.
- Tree-sitter loading is asynchronous. Use `OTUI_TREE_SITTER_WORKER_PATH` when
  packaging requires a custom worker path.
- Put large Code/Line Number views inside a height-constrained ScrollBox.

## See Also

- [Text & Display](./text-display.md) - Styled text and image rendering
- [Containers](./containers.md) - ScrollBox for large content
- [Core API](../core/api.md) - Imperative renderables
- [Testing](../testing/REFERENCE.md) - Frame and snapshot tests
