import { describe, expect, it } from 'vitest';
import { createRefresher, type RefreshResult } from './refresh';

/** A fetch whose calls resolve only when the test says so. */
function controllableFetch() {
    const calls: { withPolicy: boolean; resolve: (v: string) => void; reject: (e: unknown) => void }[] = [];
    let n = 0;
    const fetch = (withPolicy: boolean) => new Promise<string>((resolve, reject) => {
        n += 1;
        calls.push({ withPolicy, resolve, reject });
    });
    return { fetch, calls, count: () => n };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
    const f = controllableFetch();
    const applied: RefreshResult<string>[] = [];
    const failed: unknown[] = [];
    const r = createRefresher<string>({ fetch: f.fetch, apply: (x) => applied.push(x), fail: (e) => failed.push(e) });
    return { f, r, applied, failed };
}

describe('createRefresher', () => {
    it('applies a plain load', async () => {
        const { f, r, applied } = setup();
        const done = r.request({ withPolicy: true });
        f.calls[0].resolve('v1');
        await done;
        expect(applied).toEqual([{ value: 'v1', withPolicy: true }]);
    });

    it('skips a poll tick while a load runs, but queues a forced one and runs it after', async () => {
        const { f, r, applied } = setup();
        const first = r.request();
        await r.request(); // poll tick: skipped
        expect(f.count()).toBe(1);
        void r.request({ force: true, withPolicy: true }); // e.g. Refresh: queued
        expect(r.state().queued).toBe(true);
        f.calls[0].resolve('old');
        await tick();
        expect(f.count()).toBe(2);
        expect(f.calls[1].withPolicy).toBe(true);
        f.calls[1].resolve('new');
        await first;
        expect(applied.map((a) => a.value)).toEqual(['old', 'new']);
    });

    it('merges withPolicy across queued requests', async () => {
        const { f, r } = setup();
        const first = r.request();
        void r.request({ force: true, withPolicy: true });
        void r.request({ force: true, withPolicy: false });
        f.calls[0].resolve('a');
        await tick();
        expect(f.calls[1].withPolicy).toBe(true);
        f.calls[1].resolve('b');
        await first;
    });

    it('drops a response that started before a mutation (a deleted partner must not reappear)', async () => {
        const { f, r, applied } = setup();
        const poll = r.request(); // started before the delete
        r.begin(); // delete starts
        r.end(); // delete done: queues a forced reload with the policy
        f.calls[0].resolve('before-delete');
        await tick();
        expect(applied).toEqual([]); // stale: thrown away
        expect(f.count()).toBe(2);
        expect(f.calls[1].withPolicy).toBe(true);
        f.calls[1].resolve('after-delete');
        await poll;
        expect(applied).toEqual([{ value: 'after-delete', withPolicy: true }]);
    });

    it('drops polls that run DURING a mutation (an optimistic toggle must not revert)', async () => {
        const { f, r, applied } = setup();
        r.begin();
        const poll = r.request(); // starts mid-mutation
        f.calls[0].resolve('pre-toggle state');
        await poll;
        expect(applied).toEqual([]);
        r.end();
        await tick();
        f.calls[1].resolve('post-toggle state');
        await tick();
        expect(applied.map((a) => a.value)).toEqual(['post-toggle state']);
        expect(r.state()).toMatchObject({ pending: 0, inFlight: false, queued: false });
    });

    it('waits for every overlapping mutation before applying', async () => {
        const { f, r, applied } = setup();
        r.begin();
        r.begin();
        r.end(); // one still pending: the reload it starts must not apply
        f.calls[0].resolve('half');
        await tick();
        expect(applied).toEqual([]);
        r.end();
        await tick();
        f.calls[f.calls.length - 1].resolve('all done');
        await tick();
        expect(applied.map((a) => a.value)).toEqual(['all done']);
    });

    it('reports errors only for current requests', async () => {
        const { f, r, failed } = setup();
        const stale = r.request();
        r.begin();
        f.calls[0].reject(new Error('old failure'));
        await stale;
        expect(failed).toEqual([]);
        r.end();
        await tick();
        f.calls[1].reject(new Error('now'));
        await tick();
        expect(failed).toHaveLength(1);
    });
});
