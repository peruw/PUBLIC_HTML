// Barramento de eventos compartilhado entre os módulos.
// Uso: bus.on('kart:boost', fn); bus.emit('kart:boost', { kart, source });
// A lista de eventos está em ARCHITECTURE.md.

class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const off = this.on(name, (data) => {
      off();
      fn(data);
    });
    return off;
  }

  off(name, fn) {
    this.handlers.get(name)?.delete(fn);
  }

  emit(name, data) {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[bus] erro no handler de "${name}"`, err);
      }
    }
  }

  clear() {
    this.handlers.clear();
  }
}

export const bus = new EventBus();
export { EventBus };
