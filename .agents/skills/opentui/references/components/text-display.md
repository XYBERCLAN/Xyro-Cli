# Text & Display Components

Components for displaying text content in OpenTUI.

## Text Component

The primary component for displaying styled text.

### Basic Usage

```tsx
// React/Solid
<text>Hello, World!</text>

// With content prop
<text content="Hello, World!" />

// Core
const text = new TextRenderable(renderer, {
  id: "greeting",
  content: "Hello, World!",
})
```

### Styling (React/Solid)

For React and Solid, use **nested modifier tags** for text styling:

```tsx
<text fg="#FFFFFF" bg="#000000">
  <strong>Bold</strong>, <em>italic</em>, and <u>underlined</u>
</text>
```

> **Important**: Do NOT use `bold`, `italic`, `underline`, `dim`, `strikethrough` as props on `<text>` — they don't work. Always use nested tags like `<strong>`, `<em>`, `<u>`, or `<span>` with styling.

### Styling (Core) - Text Attributes

```typescript
import { TextRenderable, TextAttributes } from "@opentui/core"

const text = new TextRenderable(renderer, {
  content: "Styled",
  attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
})
```

**Available attributes:**
- `TextAttributes.BOLD`
- `TextAttributes.DIM`
- `TextAttributes.ITALIC`
- `TextAttributes.UNDERLINE`
- `TextAttributes.BLINK`
- `TextAttributes.INVERSE`
- `TextAttributes.HIDDEN`
- `TextAttributes.STRIKETHROUGH`

### Text Selection

```tsx
<text selectable>
  This text can be selected by the user
</text>

<text selectable={false}>
  This text cannot be selected
</text>
```

For copy-on-selection and the full selection API, see `keyboard/REFERENCE.md` (selection).

## Text Modifiers

Inline styling elements that must be used inside `<text>`:

### Span

Inline styled text:

```tsx
<text>
  Normal text with <span fg="red">red text</span> inline
</text>
```

### Bold/Strong

```tsx
<text>
  <strong>Bold text</strong>
  <b>Also bold</b>
</text>
```

### Italic/Emphasis

```tsx
<text>
  <em>Italic text</em>
  <i>Also italic</i>
</text>
```

### Underline

```tsx
<text>
  <u>Underlined text</u>
</text>
```

### Line Break

```tsx
<text>
  Line one
  <br />
  Line two
</text>
```

### Link

```tsx
<text>
  Visit <a href="https://example.com">our website</a>
</text>
```

### Combined Modifiers

```tsx
<text>
  <span fg="#00FF00">
    <strong>Bold green</strong>
  </span>
  and
  <span fg="#FF0000">
    <em><u>italic underlined red</u></em>
  </span>
</text>
```

## Styled Text Template (Core)

The `t` template literal for complex styling:

```typescript
import { t, bold, italic, underline, fg, bg, dim } from "@opentui/core"

const styled = t`
  ${bold("Bold")} and ${italic("italic")} text.
  ${fg("#FF0000")("Red text")} with ${bg("#0000FF")("blue background")}.
  ${dim("Dimmed")} and ${underline("underlined")}.
`

const text = new TextRenderable(renderer, {
  content: styled,
})
```

### Style Functions

| Function | Description |
|----------|-------------|
| `bold(text)` | Bold text |
| `italic(text)` | Italic text |
| `underline(text)` | Underlined text |
| `dim(text)` | Dimmed text |
| `strikethrough(text)` | Strikethrough text |
| `fg(color)(text)` | Set foreground color |
| `bg(color)(text)` | Set background color |

## ASCII Font Component

Display large ASCII art text banners.

### Basic Usage

```tsx
// React
<ascii-font text="TITLE" font="tiny" />

// Solid
<ascii_font text="TITLE" font="tiny" />

// Core
const title = new ASCIIFontRenderable(renderer, {
  id: "title",
  text: "TITLE",
  font: "tiny",
})
```

### Available Fonts

| Font | Description |
|------|-------------|
| `tiny` | Compact ASCII font |
| `block` | Block-style letters |
| `slick` | Sleek modern style |
| `shade` | Shaded 3D effect |
| `huge` | Large font |
| `grid` | Grid-style font |
| `pallet` | Pallet-style font |

### Styling

```tsx
// React
<ascii-font
  text="HELLO"
  font="block"
  color="#00FF00"
/>

// Core
import { RGBA } from "@opentui/core"

const title = new ASCIIFontRenderable(renderer, {
  text: "HELLO",
  font: "block",
  color: RGBA.fromHex("#00FF00"),
})
```

### Example Output

```
Font: tiny
╭─╮╭─╮╭─╮╭╮╭╮╭─╮╶╮╶ ╶╮
│ ││─┘├┤ │╰╯││  │  │
╰─╯╵  ╰─╯╵  ╵╰─╯╶╯╶╰─╯

Font: block
█▀▀█ █▀▀█ █▀▀ █▀▀▄
█  █ █▀▀▀ █▀▀ █  █
▀▀▀▀ ▀    ▀▀▀ ▀  ▀
```

## Image Component

Display PNG, JPEG, WebP, GIF, or raw image data. OpenTUI chooses Kitty,
Sixel, or Unicode block rendering based on terminal capabilities.

```tsx
// React and Solid
<image source="./cover.webp" fit="cover" protocol="auto" width={40} height={15} />

// Core
const image = new ImageRenderable(renderer, {
  source: "./cover.webp",
  width: 40,
  height: 15,
  fit: "cover",
  protocol: "auto",
  onError: console.error,
})
renderer.root.add(image)
await image.loadPromise
```

`source` accepts a path, supported URL, `URL`, `Blob`, `Response`,
`Uint8Array`, `ArrayBuffer`, or `NativeImage`. Replacing `source` keeps the
current image visible until the replacement succeeds.

| Option | Values | Description |
|--------|--------|-------------|
| `fit` | `fit`, `cover`, `fill` | Contain (default), crop, or stretch |
| `protocol` | `auto`, `kitty`, `sixel`, `blocks` | Requested terminal rendering protocol |
| `onLoad` | `(image: NativeImage) => void` | Current source loaded |
| `onError` | `(error: unknown) => void` | Current source failed |

State includes `image`, `loading`, `loadError`, `loadPromise`,
`effectiveProtocol`, and `getFittedSize()`. Set
`OPENTUI_IMAGE_PROTOCOL=auto|kitty|sixel|blocks` for a global default;
`OPENTUI_GRAPHICS=false` disables Kitty and Sixel detection.

### NativeImage

Use `NativeImage` when you need to inspect, transform, or share decoded pixels:

```typescript
import { NativeImage, imageInfo } from "@opentui/core"

const source = await NativeImage.load("photo.jpg")
const thumbnail = source.resize({ width: 320 })
const shared = thumbnail.retain() // Independent handle, no pixel copy

try {
  console.log(imageInfo(await Bun.file("photo.jpg").arrayBuffer()))
  const rgba = thumbnail.raw("rgba8")
} finally {
  shared.dispose()
  thumbnail.dispose()
  source.dispose()
}
```

Creation methods are `load()`, `decode()`, and `fromRgba()`. Pixel methods are
`raw()`, `copyTo()`, and ownership-transferring `takeRaw()`. Transform methods
include `resize()`, `extract()`, `extend()`, `rotate()`, `flip()`, `flop()`, and
`composite()`. `retain()` shares storage, `clone()` copies it, and every returned
native handle must be disposed separately. `ensureEncodedPng()` prepares an
encoded PNG for low-level native consumers. `ImageRenderable` retains a supplied
`NativeImage`, so the caller still owns and must dispose its source reference.

## Time to First Draw

`TimeToFirstDrawRenderable` is a rendering diagnostic. It captures
`performance.now()` on its first draw; this is a runtime-relative timestamp,
not elapsed application startup time.

```tsx
// React
<time-to-first-draw label="First draw timestamp" precision={1} />

// Solid
<time_to_first_draw label="First draw timestamp" precision={1} />

// Core
const firstDraw = new TimeToFirstDrawRenderable(renderer, {
  label: "First draw timestamp",
  precision: 1,
})
renderer.root.add(firstDraw)
```

React and Solid also export a `TimeToFirstDraw` wrapper. `runtimeMs` is `null`
before the first draw; call `reset()` to capture again. Keep `precision` an
integer from 0 through 100.

## QR Code Component

Render a QR code in the terminal. Ships as a **separate package**,
`@opentui/qrcode` (not part of `@opentui/core`).

```bash
bun add @opentui/qrcode
```

```typescript
// Core
import { createCliRenderer } from "@opentui/core"
import { QRCodeRenderable } from "@opentui/qrcode"

const renderer = await createCliRenderer()
const qr = new QRCodeRenderable(renderer, {
  id: "docs-link",
  content: "https://opentui.com/docs/getting-started",
  quietZone: 4,
  scale: 2,
})
renderer.root.add(qr)
```

React and Solid require explicit element registration (the elements are not
built in):

```tsx
// React — element <qr-code>
import { registerQRCode } from "@opentui/qrcode/react"
registerQRCode()
<qr-code content="https://opentui.com" quietZone={4} scale={2} />

// Solid — element <qr_code> (underscore)
import { registerQRCode } from "@opentui/qrcode/solid"
registerQRCode()
<qr_code content="https://opentui.com" quietZone={4} scale={2} />
```

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `content` | `string` | `""` | Text/URL to encode |
| `errorCorrectionLevel` | `ErrorCorrectionLevel` | `M` | `.L` / `.M` / `.Q` / `.H` |
| `quietZone` | `number` | `4` | Must be ≥ 4 (throws otherwise) |
| `scale` | `number` | `1` | Columns per module before fitting |
| `fit` | `"contain" \| "none"` | `"contain"` | `contain` shrinks to parent |
| `foregroundColor` | `ColorInput` | `"#000000"` | Dark module color |
| `backgroundColor` | `ColorInput` | `"#ffffff"` | Light module / quiet-zone color |
| `fallbackContent` | `string` | `""` | Shown when too small to render |
| `fallbackColor` | `ColorInput` | `"#ffffff"` | Fallback text color |

Import `ErrorCorrectionLevel` from `@opentui/qrcode`, e.g.
`errorCorrectionLevel: ErrorCorrectionLevel.H`. Read-only getters: `version`,
`moduleCount`.

## Colors

### Color Formats

```tsx
// Hex colors
<text fg="#FF0000">Red</text>
<text fg="#F00">Short hex</text>

// Named colors
<text fg="red">Red</text>
<text fg="blue">Blue</text>

// Transparent
<text bg="transparent">No background</text>
```

### RGBA Class

Color props accept string formats (`"#FF0000"`, `"#F00"`, `"red"`, `"transparent"`)
in all frameworks. For programmatic color manipulation, the `RGBA` class from
`@opentui/core` (`fromHex` / `fromInts` / `fromValues` / `parseColor`) works in
Core, React, and Solid alike:

```tsx
import { RGBA } from "@opentui/core"

<box backgroundColor={RGBA.fromHex("#1a1a2e")} borderColor={RGBA.fromInts(122, 162, 247, 255)}>
  <text fg={RGBA.fromHex("#c0caf5")}>Styled with RGBA</text>
</box>
```

See **[core/api.md → Colors (RGBA)](../core/api.md#colors-rgba)** for the full
constructor reference and the "when to use each method" guidance.

## Text Wrapping

Text wraps based on parent container:

```tsx
<box width={40}>
  <text>
    This long text will wrap when it reaches the edge of the 
    40-character wide parent container.
  </text>
</box>
```

## Dynamic Content

### React

```tsx
function Counter() {
  const [count, setCount] = useState(0)
  return <text>Count: {count}</text>
}
```

### Solid

```tsx
function Counter() {
  const [count, setCount] = createSignal(0)
  return <text>Count: {count()}</text>
}
```

### Core

```typescript
const text = new TextRenderable(renderer, {
  id: "counter",
  content: "Count: 0",
})

// Update later
text.setContent("Count: 1")
```

## Gotchas

### Text Modifiers Outside Text

```tsx
// WRONG - modifiers only work inside <text>
<box>
  <strong>Won't work</strong>
</box>

// CORRECT
<box>
  <text>
    <strong>This works</strong>
  </text>
</box>
```

### Empty Text

```tsx
// May cause layout issues
<text></text>

// Better - use space or conditional
<text>{content || " "}</text>
```

### Color Format

```tsx
// WRONG
<text fg="FF0000">Missing #</text>

// CORRECT
<text fg="#FF0000">With #</text>
```
