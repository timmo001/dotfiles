---
name: effect-ts
description: Effect-TS patterns for services, errors, layers, concurrency, and resource management. Use when writing, reviewing, or refactoring TypeScript code using the Effect library (Effect.gen, Context.Tag, Layer, PubSub, Stream, Schedule, Fiber).
---

# Effect-TS Patterns

Applies to TypeScript code using the `effect` library. This project uses **Effect 3.x** with the `Context.Tag` service pattern.

## Documentation

- Context7 library ID: `/llmstxt/effect_website_llms-small_txt` (11.7k snippets, best score)
- Alternative: `/effect-ts/effect` (repo source, 361 snippets)
- Website: https://effect.website

## Core Principles

1. Use `Effect` for any fallible or async operation — not just promises.
2. Track errors in types via the error channel. No `any` or `unknown` in error channels.
3. Prefer `Effect.gen` for sequential composition, `pipe` for linear transforms.
4. Use `Context.Tag` + `Layer` for dependency injection.
5. Use `Option` over `null`/`undefined` in domain types.
6. Use `Data.TaggedError` for domain errors.

## Service Pattern (Effect 3.x)

```typescript
import { Context, Effect, Layer } from "effect"

interface MyService {
  readonly doThing: (id: string) => Effect.Effect<Result, MyError>
}

export class MyService extends Context.Tag("MyService")<MyService, MyService>() {}

export const MyServiceLive = Layer.effect(
  MyService,
  Effect.gen(function* () {
    const dep = yield* SomeDependency
    return {
      doThing: (id) => Effect.gen(function* () {
        // resolve per-call when service may be scoped
        return yield* dep.find(id)
      }),
    }
  }),
)

// Simple services with no dependencies
export const MyServiceLive = Layer.succeed(MyService, {
  doThing: (id) => Effect.tryPromise({ ... }),
})
```

## Never Capture Scope-Bound Services at Layer Build

Inside `Layer.effect(Tag, Effect.gen(...))`, do **not** store a scope-bound service in a closure. Resolve per call instead.

```typescript
// WRONG — captures at build, stale across concurrent callers
export const FooLive = Layer.effect(Foo, Effect.gen(function* () {
  const db = yield* Database  // captured once
  return { query: (q) => db.run(q) }  // uses stale ref
}))

// RIGHT — resolve fresh per call
export const FooLive = Layer.effect(Foo, Effect.gen(function* () {
  return {
    query: (q) => Effect.gen(function* () {
      const db = yield* Database  // fresh per call
      return yield* db.run(q)
    }),
  }
}))
```

Process-singleton services (static config, crypto keys) can be captured at build.

## Layer Composition

```typescript
// Merge independent layers
const AppLayer = Layer.mergeAll(ServiceALive, ServiceBLive)

// Chain dependent layers
const AppLayer = ServiceALive.pipe(
  Layer.provideMerge(ServiceBLive),
  Layer.provideMerge(ServiceCLive),
)

// Provide to program
Effect.runPromise(program.pipe(
  Effect.scoped,
  Effect.provide(AppLayer),
))
```

## Error Handling

```typescript
import { Data, Effect } from "effect"

// Define domain errors
export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly entity: string
  readonly id: string
}> {}

// Catch specific errors
effect.pipe(
  Effect.catchTag("NotFoundError", (e) => Effect.succeed(null)),
)

// Catch multiple
effect.pipe(
  Effect.catchTags({
    NotFoundError: (e) => Effect.succeed(null),
    ValidationError: (e) => Effect.fail(new UserError({ message: e.message })),
  }),
)
```

## Concurrency

```typescript
import { Effect, PubSub, Stream, Schedule, Fiber } from "effect"

// Parallel execution
const [a, b] = yield* Effect.all([effectA, effectB], { concurrency: 2 })

// PubSub for event distribution
const pubsub = yield* PubSub.unbounded<Event>()
yield* PubSub.publish(pubsub, event)
const stream = Stream.fromPubSub(pubsub)

// Scheduled repetition
yield* poll.pipe(
  Effect.repeat(Schedule.spaced("10 seconds")),
  Effect.forkScoped,  // NOT forkDaemon — see scope rules
)

// Stream consumption
yield* stream.pipe(
  Stream.runForEach((item) => Effect.sync(() => handle(item))),
  Effect.forkScoped,
)
```

## Fiber Scope Rules

- **`Effect.forkScoped`**: fiber lifecycle tied to enclosing scope. Use for background tasks that should stop when the parent exits. **Preferred default.**
- **`Effect.forkDaemon`**: fiber runs outside all scopes, lives until process exit. Loses access to scope-bound services. Use only when the fiber must outlive its parent.
- **`Effect.fork`**: fiber tied to parent fiber's lifetime.

If a fiber needs `Effect.addFinalizer` or scope-bound services, it **must** use `forkScoped`, not `forkDaemon`.

## Resource Management

```typescript
// Scoped resources with cleanup
const program = Effect.gen(function* () {
  yield* Effect.addFinalizer(() => Effect.sync(() => cleanup()))
  // ...
}).pipe(Effect.scoped)

// Acquire/release pattern
const resource = Effect.acquireRelease(
  acquire,
  (res) => Effect.sync(() => res.close()),
)
```

## Running Effects

```typescript
// Keep process alive (for long-running apps)
Effect.runPromise(program).catch(console.error)

// Do NOT use Effect.runFork for top-level — process may exit immediately.
// Effect.runFork is for fire-and-forget inside an already-running effect.
```

## Wrapping External APIs

```typescript
// Bun.spawn / child process
Effect.tryPromise({
  try: async () => {
    const proc = Bun.spawn(["cmd", ...args], { stdout: "pipe", stderr: "pipe" })
    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) throw new Error(`Failed (exit ${exitCode})`)
    return parse(stdout)
  },
  catch: (error) => error instanceof Error ? error : new Error(String(error)),
})
```

## Forbidden Patterns

| Pattern | Why | Use Instead |
|---|---|---|
| `Effect.runFork` at top level | Process exits immediately | `Effect.runPromise` |
| `Effect.forkDaemon` for scoped work | Loses scope/finalizers | `Effect.forkScoped` |
| `throw` inside `Effect.gen` | Uncatchable by Effect | `Effect.fail` |
| `try/catch` in `Effect.gen` | Never catches yielded effects | `Effect.catchTag` |
| `Effect.runSync` inside effects | Loses error tracking | `yield*` |
| `console.log` | Not structured | `Effect.log` |
| `catchAll` discarding type info | Loses error specificity | `catchTag`/`catchTags` |
| Capturing scoped services at build | Stale refs across callers | Resolve per call |
