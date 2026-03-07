/**
 * B+ Tree implementation for optimized prefix searching
 * Used for autocomplete and search features
 */

export interface BPlusTreeNode<T> {
  keys: string[];
  values?: T[];
  children?: BPlusTreeNode<T>[];
  isLeaf: boolean;
  next?: BPlusTreeNode<T>; // Link to next leaf node for range queries
}

export class BPlusTree<T> {
  private root: BPlusTreeNode<T>;
  private readonly order: number; // Maximum number of children per node
  private readonly minKeys: number;

  constructor(order: number = 50) {
    this.order = order;
    this.minKeys = Math.ceil(order / 2) - 1;
    this.root = {
      keys: [],
      values: [],
      isLeaf: true,
    };
  }

  /**
   * Insert a key-value pair into the B+ tree
   */
  insert(key: string, value: T): void {
    const normalizedKey = key.toLowerCase().trim();

    if (!normalizedKey) return;

    const result = this.insertInternal(this.root, normalizedKey, value);

    // If root was split, create new root
    if (result) {
      this.root = {
        keys: [result.key],
        children: [this.root, result.newNode],
        isLeaf: false,
      };
    }
  }

  private insertInternal(
    node: BPlusTreeNode<T>,
    key: string,
    value: T
  ): { key: string; newNode: BPlusTreeNode<T> } | null {
    if (node.isLeaf) {
      return this.insertIntoLeaf(node, key, value);
    } else {
      return this.insertIntoInternal(node, key, value);
    }
  }

  private insertIntoLeaf(
    node: BPlusTreeNode<T>,
    key: string,
    value: T
  ): { key: string; newNode: BPlusTreeNode<T> } | null {
    // Find insertion position
    let pos = 0;
    while (pos < node.keys.length && node.keys[pos] < key) {
      pos++;
    }

    // Check if key already exists (update value)
    if (pos < node.keys.length && node.keys[pos] === key) {
      if (node.values) {
        // Check if value already exists in array
        const valueArray = Array.isArray(node.values[pos])
          ? node.values[pos] as unknown as T[]
          : [node.values[pos]];

        if (!valueArray.some(v => JSON.stringify(v) === JSON.stringify(value))) {
          node.values[pos] = [...valueArray, value] as T;
        }
      }
      return null;
    }

    // Insert key and value
    node.keys.splice(pos, 0, key);
    if (node.values) {
      node.values.splice(pos, 0, value);
    }

    // Check if node needs to be split
    if (node.keys.length > this.order - 1) {
      return this.splitLeaf(node);
    }

    return null;
  }

  private insertIntoInternal(
    node: BPlusTreeNode<T>,
    key: string,
    value: T
  ): { key: string; newNode: BPlusTreeNode<T> } | null {
    // Find child to insert into
    let pos = 0;
    while (pos < node.keys.length && key >= node.keys[pos]) {
      pos++;
    }

    const child = node.children![pos];
    const result = this.insertInternal(child, key, value);

    if (!result) return null;

    // Insert new key and child pointer
    node.keys.splice(pos, 0, result.key);
    node.children!.splice(pos + 1, 0, result.newNode);

    // Check if node needs to be split
    if (node.keys.length > this.order - 1) {
      return this.splitInternal(node);
    }

    return null;
  }

  private splitLeaf(
    node: BPlusTreeNode<T>
  ): { key: string; newNode: BPlusTreeNode<T> } {
    const mid = Math.floor(node.keys.length / 2);

    const newNode: BPlusTreeNode<T> = {
      keys: node.keys.splice(mid),
      values: node.values!.splice(mid),
      isLeaf: true,
      next: node.next,
    };

    node.next = newNode;

    return {
      key: newNode.keys[0],
      newNode,
    };
  }

  private splitInternal(
    node: BPlusTreeNode<T>
  ): { key: string; newNode: BPlusTreeNode<T> } {
    const mid = Math.floor(node.keys.length / 2);
    const midKey = node.keys[mid];

    const newNode: BPlusTreeNode<T> = {
      keys: node.keys.splice(mid + 1),
      children: node.children!.splice(mid + 1),
      isLeaf: false,
    };

    node.keys.splice(mid, 1); // Remove the middle key (it goes up)

    return {
      key: midKey,
      newNode,
    };
  }

  /**
   * Search for keys with a given prefix
   * Returns up to 'limit' results
   */
  searchPrefix(prefix: string, limit: number = 15): T[] {
    const normalizedPrefix = prefix.toLowerCase().trim();

    if (!normalizedPrefix) return [];

    const results: T[] = [];
    const leafNode = this.findLeafNode(this.root, normalizedPrefix);

    if (!leafNode) return results;

    // Traverse leaf nodes using the linked list
    let currentNode: BPlusTreeNode<T> | undefined = leafNode;

    while (currentNode && results.length < limit) {
      for (let i = 0; i < currentNode.keys.length && results.length < limit; i++) {
        const key = currentNode.keys[i];

        if (key.startsWith(normalizedPrefix)) {
          const value = currentNode.values![i];

          // If value is an array, add all items
          if (Array.isArray(value)) {
            results.push(...(value as T[]));
          } else {
            results.push(value);
          }
        } else if (key > normalizedPrefix && !key.startsWith(normalizedPrefix)) {
          // We've passed the prefix range
          return results.slice(0, limit);
        }
      }

      currentNode = currentNode.next;
    }

    return results.slice(0, limit);
  }

  /**
   * Exact search for a key
   */
  search(key: string): T[] {
    const normalizedKey = key.toLowerCase().trim();
    const leafNode = this.findLeafNode(this.root, normalizedKey);

    if (!leafNode) return [];

    const index = leafNode.keys.indexOf(normalizedKey);
    if (index === -1) return [];

    const value = leafNode.values![index];
    return Array.isArray(value) ? (value as T[]) : [value];
  }

  private findLeafNode(
    node: BPlusTreeNode<T>,
    key: string
  ): BPlusTreeNode<T> | null {
    if (node.isLeaf) {
      return node;
    }

    // Find which child to traverse
    let pos = 0;
    while (pos < node.keys.length && key >= node.keys[pos]) {
      pos++;
    }

    return this.findLeafNode(node.children![pos], key);
  }

  /**
   * Bulk insert multiple key-value pairs
   * More efficient than individual inserts
   */
  bulkInsert(items: Array<{ key: string; value: T }>): void {
    // Sort items by key for better insertion performance
    const sortedItems = items
      .map(item => ({
        key: item.key?.toLowerCase().trim(),
        value: item.value,
      }))
      .sort((a, b) => a.key?.localeCompare(b.key));

    for (const item of sortedItems) {
      if (item.key) {
        this.insert(item.key, item.value);
      }
    }
  }

  /**
   * Get all keys in sorted order
   */
  getAllKeys(): string[] {
    const keys: string[] = [];
    let currentNode = this.getFirstLeaf(this.root);

    while (currentNode) {
      keys.push(...currentNode.keys);
      currentNode = currentNode.next;
    }

    return keys;
  }

  private getFirstLeaf(node: BPlusTreeNode<T>): BPlusTreeNode<T> {
    if (node.isLeaf) {
      return node;
    }
    return this.getFirstLeaf(node.children![0]);
  }

  /**
   * Get statistics about the tree
   */
  getStats(): {
    totalKeys: number;
    height: number;
    leafNodes: number;
  } {
    const allKeys = this.getAllKeys();
    return {
      totalKeys: allKeys.length,
      height: this.getHeight(this.root),
      leafNodes: this.countLeafNodes(this.root),
    };
  }

  private getHeight(node: BPlusTreeNode<T>): number {
    if (node.isLeaf) return 1;
    return 1 + this.getHeight(node.children![0]);
  }

  private countLeafNodes(node: BPlusTreeNode<T>): number {
    if (node.isLeaf) return 1;
    return node.children!.reduce((count, child) => count + this.countLeafNodes(child), 0);
  }

  /**
   * Clear all data from the tree
   */
  clear(): void {
    this.root = {
      keys: [],
      values: [],
      isLeaf: true,
    };
  }
}
