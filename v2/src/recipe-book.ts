// Java 1.21.1 unlock_recipes: 0 replaces known recipes, 1 adds, 2 removes.
// recipes2 is the initial highlight list, NOT a second source of knowledge.
export class RecipeBook {
  private known = new Set<string>();
  private initialized = false;
  apply(packet: { action: number; recipes1: string[]; recipes2?: string[] }) {
    if (![0, 1, 2].includes(packet.action) || !Array.isArray(packet.recipes1)
      || packet.recipes1.some(id => typeof id !== 'string')) return;
    if (packet.action === 0) { this.known.clear(); this.initialized = true; }
    if (!this.initialized) return; // Never infer a full book from a partial update.
    for (const id of packet.recipes1) {
      if (packet.action === 2) this.known.delete(id); else this.known.add(id);
    }
  }
  reset() { this.known.clear(); this.initialized = false; }
  snapshot() { return { initialized: this.initialized, unlocked: [...this.known].sort() }; }
}
