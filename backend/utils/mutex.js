/**
 * Keyed Mutex for Concurrency Safety
 * Serializes async operations targeting the same resource (e.g. location_id)
 * to avoid thread/event-loop interleaving races.
 */

class KeyedMutex {
    constructor() {
        this.queues = new Map();
    }

    /**
     * Executes async function `fn` exclusively for the specified key
     * @param {string} key - e.g. locationId
     * @param {Function} fn - async function to execute safely
     */
    async runExclusive(key, fn) {
        let releaseLock;
        const currentLock = new Promise(resolve => {
            releaseLock = resolve;
        });

        // Wait for prior operations on this key
        const previousLock = this.queues.get(key) || Promise.resolve();
        this.queues.set(key, (async () => {
            try {
                await previousLock;
            } catch {
                // Ignore errors from previous task so queue does not stall
            }
            return currentLock;
        })());

        try {
            await previousLock;
            return await fn();
        } finally {
            releaseLock();
            // Clean up queue when empty
            if (this.queues.get(key) === currentLock) {
                this.queues.delete(key);
            }
        }
    }
}

const locationMutex = new KeyedMutex();

module.exports = {
    locationMutex
};
