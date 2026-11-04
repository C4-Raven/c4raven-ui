/**
 * Keeps the page's data fresh without races between the poll and mutations.
 *
 * - Every mutation calls begin() and end(); both bump a generation counter, so
 *   a response to a request started before (or during) a mutation is thrown
 *   away instead of overwriting newer state (a deleted partner reappearing, an
 *   optimistic toggle reverting).
 * - end() always requests a fresh load (with the policy/map).
 * - A forced request (refresh after a mutation, the Refresh button) that comes
 *   in while a load is running is queued and run right after it; a plain poll
 *   tick is simply skipped then.
 * - "withPolicy" requests merge, so a queued map reload is never lost.
 */
export interface RefreshResult<T> {
    value: T;
    withPolicy: boolean;
}

export interface Refresher {
    /** force: queue if busy instead of skipping. withPolicy: also reload the policy/map. */
    request: (opts?: { force?: boolean; withPolicy?: boolean }) => Promise<void>;
    begin: () => void;
    end: () => void;
    /** For tests and debugging. */
    state: () => { generation: number; pending: number; inFlight: boolean; queued: boolean };
}

export function createRefresher<T>({ fetch, apply, fail }: {
    fetch: (withPolicy: boolean) => Promise<T>;
    apply: (result: RefreshResult<T>) => void;
    fail: (err: unknown) => void;
}): Refresher {
    let generation = 0;
    let pending = 0;
    let inFlight = false;
    let queued: { withPolicy: boolean } | null = null;

    async function run(withPolicy: boolean): Promise<void> {
        inFlight = true;
        const started = generation;
        try {
            const value = await fetch(withPolicy);
            if (started === generation && pending === 0) { apply({ value, withPolicy }); }
        } catch (err) {
            if (started === generation && pending === 0) { fail(err); }
        } finally {
            inFlight = false;
        }
        if (queued) {
            const next = queued;
            queued = null;
            await run(next.withPolicy);
        }
    }

    async function request({ force = false, withPolicy = false } = {}): Promise<void> {
        if (inFlight) {
            if (force) { queued = { withPolicy: withPolicy || !!queued?.withPolicy }; }
            return;
        }
        await run(withPolicy);
    }

    return {
        request,
        begin: () => { generation += 1; pending += 1; },
        end: () => {
            generation += 1;
            pending = Math.max(0, pending - 1);
            void request({ force: true, withPolicy: true });
        },
        state: () => ({ generation, pending, inFlight, queued: queued !== null }),
    };
}

/** Reload the policy/map on every Nth poll tick (10 s polls: every 40 s). */
export const POLICY_EVERY_N_POLLS = 4;
