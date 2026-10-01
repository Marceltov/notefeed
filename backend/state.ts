// Process-wide state. Next can instantiate a module once per route bundle, so a module-level Map in
// the POST route and in a page might not be the same Map; globalThis is shared by all of them.
export function processState<T extends object>(key: string, init: () => T): T {
  const g = globalThis as Record<symbol, unknown>;
  return (g[Symbol.for(`notefeed.${key}`)] ??= init()) as T;
}
