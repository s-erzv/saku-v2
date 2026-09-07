// Simple event bus for cross-component communication
type EventCallback = () => void

class EventEmitter {
  private events: Map<string, Set<EventCallback>> = new Map()

  on(event: string, callback: EventCallback) {
    if (!this.events.has(event)) {
      this.events.set(event, new Set())
    }
    this.events.get(event)!.add(callback)
  }

  off(event: string, callback: EventCallback) {
    const callbacks = this.events.get(event)
    if (callbacks) {
      callbacks.delete(callback)
    }
  }

  emit(event: string) {
    const callbacks = this.events.get(event)
    if (callbacks) {
      callbacks.forEach(callback => callback())
    }
  }
}

export const eventBus = new EventEmitter()

// Event names
export const EVENTS = {
  BALANCE_REFRESH: 'balance:refresh',
  TRANSFER_SUCCESS: 'transfer:success',
  TRANSACTIONS_REFRESH: 'transactions:refresh', // tambahkan ini
}
