# Animation System

OpenTUI provides a timeline-based animation system for smooth property transitions.

## Overview

Animations in OpenTUI use:
- **Timeline**: Orchestrates multiple animations
- **Animation Engine**: Manages timelines and rendering
- **Easing Functions**: Control animation curves

## When to Use

Use this reference when you need timeline-driven animations, easing curves, or progressive transitions.

## Basic Usage

### React

```tsx
import { useTimeline } from "@opentui/react"
import { useEffect, useState } from "react"

function AnimatedBox() {
  const [width, setWidth] = useState(0)
  
  const timeline = useTimeline({
    duration: 2000,
  })
  
  useEffect(() => {
    timeline.add(
      { width: 0 },
      {
        width: 50,
        duration: 2000,
        ease: "outQuad",
        onUpdate: (anim) => {
          setWidth(Math.round(anim.targets[0].width))
        },
      }
    )
  }, [])
  
  return (
    <box
      width={width}
      height={3}
      backgroundColor="#6a5acd"
    />
  )
}
```

### Solid

```tsx
import { useTimeline } from "@opentui/solid"
import { createSignal, onMount } from "solid-js"

function AnimatedBox() {
  const [width, setWidth] = createSignal(0)
  
  const timeline = useTimeline({
    duration: 2000,
  })
  
  onMount(() => {
    timeline.add(
      { width: 0 },
      {
        width: 50,
        duration: 2000,
        ease: "outQuad",
        onUpdate: (anim) => {
          setWidth(Math.round(anim.targets[0].width))
        },
      }
    )
  })
  
  return (
    <box
      width={width()}
      height={3}
      backgroundColor="#6a5acd"
    />
  )
}
```

### Core

```typescript
import { createCliRenderer, Timeline, engine } from "@opentui/core"

const renderer = await createCliRenderer()
engine.attach(renderer)

const timeline = new Timeline({
  duration: 2000,
  autoplay: true,
})

timeline.add(
  { x: 0 },
  {
    x: 50,
    duration: 2000,
    ease: "outQuad",
    onUpdate: (anim) => {
      box.left = Math.round(anim.targets[0].x)
    },
  }
)

engine.register(timeline)
```

## Timeline Options

```typescript
const timeline = useTimeline({
  duration: 2000,         // Total duration in ms
  loop: false,            // Loop the timeline
  autoplay: true,         // Start automatically
  onComplete: () => {},   // Called when timeline completes
  onPause: () => {},      // Called when timeline pauses
})
```

## Timeline Methods

```typescript
// Add animation
timeline.add(target, properties, startTime?)

// Control playback
timeline.play()           // Start/resume
timeline.pause()          // Pause
timeline.restart()        // Restart from beginning

// State
timeline.currentTime      // Current position in milliseconds
timeline.duration         // Total duration
```

## Animation Properties

```typescript
timeline.add(
  { value: 0 },           // Target object with initial values
  {
    value: 100,           // Final value
    duration: 1000,       // Animation duration in ms
    ease: "linear",       // Easing function
    onUpdate: (anim) => {
      // Called each frame
      const current = anim.targets[0].value
    },
    onComplete: () => {
      // Called when this animation completes
    },
  },
  0                       // Start time in timeline; use this instead of delay
)
```

## Easing Functions

Available easing functions:

### Linear

| Name | Description |
|------|-------------|
| `linear` | Constant speed |

### Curves

| Family | Names |
|--------|-------|
| Quad | `inQuad`, `outQuad`, `inOutQuad` |
| Expo | `inExpo`, `outExpo` |
| Sine | `inOutSine` |
| Circular | `inCirc`, `outCirc`, `inOutCirc` |
| Back | `inBack`, `outBack`, `inOutBack` |
| Bounce | `inBounce`, `outBounce` |
| Elastic | `outElastic` |

## Patterns

### Progress Bar

```tsx
function ProgressBar({ progress }: { progress: number }) {
  const [width, setWidth] = useState(0)
  const maxWidth = 50
  
  const timeline = useTimeline()
  
  useEffect(() => {
    timeline.add(
      { value: width },
      {
        value: (progress / 100) * maxWidth,
        duration: 300,
        ease: "outQuad",
        onUpdate: (anim) => {
          setWidth(Math.round(anim.targets[0].value))
        },
      }
    )
  }, [progress])
  
  return (
    <box flexDirection="column" gap={1}>
      <text>Progress: {progress}%</text>
      <box width={maxWidth} height={1} backgroundColor="#333">
        <box width={width} height={1} backgroundColor="#00FF00" />
      </box>
    </box>
  )
}
```

### Fade In

```tsx
function FadeIn({ children }) {
  const [opacity, setOpacity] = useState(0)
  
  const timeline = useTimeline()
  
  useEffect(() => {
    timeline.add(
      { opacity: 0 },
      {
        opacity: 1,
        duration: 500,
        ease: "outQuad",
        onUpdate: (anim) => {
          setOpacity(anim.targets[0].opacity)
        },
      }
    )
  }, [])
  
  return (
    <box style={{ opacity }}>
      {children}
    </box>
  )
}
```

### Looping Animation

```tsx
function Spinner() {
  const [frame, setFrame] = useState(0)
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  
  useEffect(() => {
    const interval = setInterval(() => {
      setFrame(f => (f + 1) % frames.length)
    }, 80)
    
    return () => clearInterval(interval)
  }, [])
  
  return <text>{frames[frame]} Loading...</text>
}
```

### Staggered Animation

```tsx
function StaggeredList({ items }) {
  const [visibleCount, setVisibleCount] = useState(0)
  
  useEffect(() => {
    let count = 0
    const interval = setInterval(() => {
      count++
      setVisibleCount(count)
      if (count >= items.length) {
        clearInterval(interval)
      }
    }, 100)
    
    return () => clearInterval(interval)
  }, [items.length])
  
  return (
    <box flexDirection="column">
      {items.slice(0, visibleCount).map((item, i) => (
        <text key={i}>{item}</text>
      ))}
    </box>
  )
}
```

### Slide In

```tsx
function SlideIn({ children, from = "left" }) {
  const [offset, setOffset] = useState(from === "left" ? -20 : 20)
  
  const timeline = useTimeline()
  
  useEffect(() => {
    timeline.add(
      { offset: from === "left" ? -20 : 20 },
      {
        offset: 0,
        duration: 300,
        ease: "outQuad",
        onUpdate: (anim) => {
          setOffset(Math.round(anim.targets[0].offset))
        },
      }
    )
  }, [])
  
  return (
    <box position="relative" left={offset}>
      {children}
    </box>
  )
}
```

## Performance Tips

### Batch Updates

Timeline automatically batches updates within the render loop.

### Use Integer Values

Round animated values for character-based positioning:

```typescript
onUpdate: (anim) => {
  setX(Math.round(anim.targets[0].x))
}
```

### Clean Up Timelines

Hooks automatically clean up, but for core:

```typescript
// When done with timeline
engine.unregister(timeline)
```

## Gotchas

### Terminal Refresh Rate

Terminal UIs typically refresh at 60 FPS max. Very fast animations may appear choppy.

### Character Grid

Animations are constrained to character cells. Sub-pixel positioning isn't possible.

### Cleanup in Effects

Always clean up intervals and timelines:

```tsx
useEffect(() => {
  const interval = setInterval(...)
  return () => clearInterval(interval)
}, [])
```

## See Also

- [React API](../react/api.md) - `useTimeline` hook reference
- [Solid API](../solid/api.md) - `useTimeline` hook reference
- [Core API](../core/api.md) - `AnimationEngine` and `Timeline` classes
- [Layout Patterns](../layout/patterns.md) - Animated positioning and transitions
