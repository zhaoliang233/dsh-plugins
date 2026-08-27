const REGISTRY = Symbol.for('dsh.workspace-method-interceptors.v1')

function root() {
  let value = globalThis[REGISTRY]
  if (value === undefined) {
    value = new WeakMap()
    Object.defineProperty(globalThis, REGISTRY, { value })
  }
  if (!(value instanceof WeakMap)) throw new Error('incompatible test interceptor registry')
  return value
}

export function installTestInterceptor(target, name, order, handler) {
  const registry = root()
  let methods = registry.get(target)
  if (methods === undefined) {
    methods = new Map()
    registry.set(target, methods)
  }
  let state = methods.get(name)
  if (state === undefined) {
    const original = target[name]
    const entries = new Map()
    state = { original, entries, wrapper: undefined }
    state.wrapper = function (...args) {
      const chain = [...entries.values()].sort((left, right) => left.order - right.order)
      const receiver = this
      const dispatch = (index, currentArgs) => {
        const entry = chain[index]
        if (entry === undefined) return Reflect.apply(original, receiver, currentArgs)
        return entry.handler(
          (...nextArgs) => dispatch(index + 1, nextArgs.length === 0 ? currentArgs : nextArgs),
          ...currentArgs
        )
      }
      return dispatch(0, args)
    }
    methods.set(name, state)
    target[name] = state.wrapper
  }
  const key = Symbol('test-interceptor')
  state.entries.set(key, { order, handler })
  return () => {
    state.entries.delete(key)
    if (state.entries.size !== 0) return
    if (target[name] === state.wrapper) target[name] = state.original
    methods.delete(name)
    if (methods.size === 0) registry.delete(target)
  }
}
