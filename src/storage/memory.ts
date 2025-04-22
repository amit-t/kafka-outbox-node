import { OutboxEvent, OutboxStorage } from '../index';

/**
 * In-memory implementation of OutboxStorage interface.
 * Useful for testing and development.
 */
export class InMemoryOutboxStorage implements OutboxStorage {
  private events: Map<string, OutboxEvent> = new Map();

  constructor() {
    // No configuration needed for in-memory storage
  }

  async saveEvent(event: OutboxEvent): Promise<void> {
    this.events.set(event.id, { ...event });
  }

  async markPublished(id: string): Promise<void> {
    const event = this.events.get(id);
    if (event) {
      event.published = true;
      this.events.set(id, event);
    }
  }

  async getUnpublishedEvents(): Promise<OutboxEvent[]> {
    return Array.from(this.events.values())
      .filter(event => !event.published)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /**
   * Gets all events (both published and unpublished)
   */
  async getAllEvents(): Promise<OutboxEvent[]> {
    return Array.from(this.events.values())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /**
   * Clears all events from memory
   */
  async clear(): Promise<void> {
    this.events.clear();
  }

  /**
   * Close is a no-op for in-memory storage
   */
  async close(): Promise<void> {
    // Nothing to do
  }
}
