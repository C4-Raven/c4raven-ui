import { describe, expect, it } from 'vitest';
import {
    addCaToPolicy,
    addViewNodes,
    blankPluginRouting,
    descriptionNote,
    nodeMeta,
    ownNodeActive,
    pluginRoutingValid,
    withDescriptionNote,
    withGroupSets,
    blankFederation,
    buildSaveBody,
    connectionDirection,
    entityLiveState,
    filterWarnings,
    formatBytes,
    formatFingerprint,
    formatPercent,
    isBridgeConnection,
    isPolicyDirty,
    isSecretKey,
    maskSecret,
    metricValue,
    normalizePolicy,
    orphanRules,
    outgoingEntity,
    outgoingFormFromEntity,
    parsePolicyJson,
    pollUntil,
    removeEntities,
    removeEntitiesForCa,
    removeGroupSet,
    restoreOwnNode,
    splitGroups,
    tokenFingerprint,
    validateOutgoing,
    blankOutgoing,
    withToken,
    withoutToken,
} from './helpers';
import type { CaGroup, PolicyCore } from './types';

const own: CaGroup = { alias: 'aa11', nickname: 'Us', uid: 'CN=Hub-aa11', issuer: 'CN=Hub', subject: 'CN=Hub', hubGroup: true };
const theirs: CaGroup = { alias: 'bb22', nickname: 'Them', uid: 'CN=Hub-bb22', issuer: 'CN=Hub', subject: 'CN=Hub', hubGroup: false };

function ids() {
    let n = 0;
    return () => `id${++n}`;
}

function samplePolicy(): PolicyCore {
    return {
        entities: [
            { id: 'own', type: 'FederationGroup', name: own.uid, config: { enabled: true } },
            { id: 'p', type: 'FederationGroup', name: theirs.uid, config: { enabled: true } },
            { id: 'out', type: 'FederationOutgoing', name: 'Partner_x', displayName: 'Partner', config: { host: '10.0.0.5', port: 9102, enabled: true } },
        ],
        rules: [
            { id: 'r1', name: 'own->p', source: 'own', destination: 'p', filter: { groupsFilterType: 'allGroups', allowedGroups: [], disallowedGroups: [] } },
            { id: 'r2', name: 'p->own', source: 'p', destination: 'own', filter: { groupsFilterType: 'allGroups', allowedGroups: [], disallowedGroups: [] } },
            { id: 'r3', name: 'own->out', source: 'own', destination: 'out', filter: { groupsFilterType: 'allowed', allowedGroups: ['gs1', 'Blue'], disallowedGroups: [] } },
        ],
        groupSets: [{ id: 'gs1', name: 'Set one', groups: ['A'] }],
    };
}

describe('policy normalisation and dirty detection', () => {
    it('fills missing arrays and treats {} arrays as empty', () => {
        expect(normalizePolicy({ entities: {} })).toMatchObject({ entities: [], rules: [], groupSets: [] });
        expect(normalizePolicy(null).entities).toEqual([]);
    });

    it('ignores key order and missing-vs-empty arrays', () => {
        expect(isPolicyDirty({ rules: [], entities: [] }, { entities: [], rules: [], groupSets: [] })).toBe(false);
        const a = samplePolicy();
        const b = JSON.parse(JSON.stringify(a));
        b.entities[0] = { config: { enabled: true }, name: own.uid, type: 'FederationGroup', id: 'own' };
        expect(isPolicyDirty(a, b)).toBe(false);
    });

    it('detects a real change', () => {
        const a = samplePolicy();
        const b = { ...a, rules: a.rules.slice(1) };
        expect(isPolicyDirty(a, b)).toBe(true);
    });

    it('parses raw JSON or returns null', () => {
        expect(parsePolicyJson('{')).toBeNull();
        expect(parsePolicyJson('[]')).toBeNull();
        expect(parsePolicyJson('{"entities":[]}')?.rules).toEqual([]);
    });
});

describe('node and edge removal', () => {
    it('removes entities and every rule touching them', () => {
        const r = removeEntities(samplePolicy(), ['p']);
        expect(r.policy.entities.map((e) => e.id)).toEqual(['own', 'out']);
        expect(r.policy.rules.map((x) => x.id)).toEqual(['r3']);
        expect(r.removedRules.map((x) => x.id)).toEqual(['r1', 'r2']);
        expect(r.removedEntities).toHaveLength(1);
    });

    it('removes the nodes named after a CA uid (delete-CA flow)', () => {
        const r = removeEntitiesForCa(samplePolicy(), theirs.uid);
        expect(r.removedEntities.map((e) => e.id)).toEqual(['p']);
        expect(orphanRules(r.policy)).toEqual([]);
    });

    it('is a no-op for an unknown CA', () => {
        const r = removeEntitiesForCa(samplePolicy(), 'nope');
        expect(r.removedEntities).toEqual([]);
        expect(r.policy.rules).toHaveLength(3);
    });

    it('finds orphan rules', () => {
        const p = samplePolicy();
        p.entities = p.entities.filter((e) => e.id !== 'out');
        expect(orphanRules(p).map((r) => r.id)).toEqual(['r3']);
    });

    it('strips a deleted group set from rule filters', () => {
        const p = removeGroupSet(samplePolicy(), 'gs1');
        expect(p.groupSets).toEqual([]);
        expect(p.rules.find((r) => r.id === 'r3')?.filter.allowedGroups).toEqual(['Blue']);
    });
});

describe('restoreOwnNode', () => {
    it('puts the own node back with allGroups rules both ways to every group and outgoing node', () => {
        const base = samplePolicy();
        const without = { ...base, entities: base.entities.filter((e) => e.id !== 'own'), rules: [] };
        const p = restoreOwnNode(without, own, ids());
        const node = p.entities.find((e) => e.name === own.uid)!;
        expect(node.type).toBe('FederationGroup');
        expect(p.rules.map((r) => [r.source, r.destination])).toEqual([
            [node.id, 'p'], ['p', node.id], [node.id, 'out'], ['out', node.id],
        ]);
        expect(p.rules.every((r) => r.filter.groupsFilterType === 'allGroups')).toBe(true);
    });

    it('keeps existing rules and is idempotent', () => {
        const base = samplePolicy();
        const once = restoreOwnNode(base, own, ids());
        // own->p, p->own and own->out existed; only out->own is added (r3's filter is kept)
        expect(once.rules).toHaveLength(4);
        expect(once.rules.find((r) => r.id === 'r3')!.filter.groupsFilterType).toBe('allowed');
        expect(restoreOwnNode(once, own, ids())).toEqual(once);
    });
});

describe('addCaToPolicy', () => {
    it('adds the CA node and allGroups rules both ways with the own CA', () => {
        const base = normalizePolicy({ entities: [{ id: 'own', type: 'FederationGroup', name: own.uid, displayName: 'Us' }] });
        const p = addCaToPolicy(base, theirs, own, ids());
        const node = p.entities.find((e) => e.name === theirs.uid);
        expect(node?.type).toBe('FederationGroup');
        expect(node?.displayName).toBe('Them');
        expect(p.rules).toHaveLength(2);
        expect(p.rules.every((r) => r.filter.groupsFilterType === 'allGroups')).toBe(true);
        expect(p.rules.map((r) => [r.source, r.destination])).toEqual([['own', node!.id], [node!.id, 'own']]);
    });

    it('adds a missing own-CA node too', () => {
        const p = addCaToPolicy(normalizePolicy({}), theirs, own, ids());
        expect(p.entities.map((e) => e.name)).toEqual([theirs.uid, own.uid]);
        expect(p.rules).toHaveLength(2);
    });

    it('is idempotent', () => {
        const once = addCaToPolicy(normalizePolicy({}), theirs, own, ids());
        const twice = addCaToPolicy(once, theirs, own, ids());
        expect(twice.entities).toHaveLength(2);
        expect(twice.rules).toHaveLength(2);
    });

    it('adds only the node when no own CA is given', () => {
        const p = addCaToPolicy(normalizePolicy({}), theirs, null, ids());
        expect(p.entities).toHaveLength(1);
        expect(p.rules).toHaveLength(0);
    });
});

describe('G12 filter warning', () => {
    it('flags non-allGroups rules leaving the own-CA node', () => {
        expect(filterWarnings(samplePolicy(), own.uid).map((r) => r.id)).toEqual(['r3']);
    });

    it('flags rules leaving a node the server tagged as a Raven hub (description metadata)', () => {
        const p = samplePolicy();
        p.rules[1].filter.groupsFilterType = 'disallowed';
        // Untagged: r2 (p -> own) isn't a Raven source, so no warning for it.
        expect(filterWarnings(p, null).map((r) => r.id)).toEqual([]);
        // Exactly what fedhub_partners.set_node_meta writes.
        p.entities[1].description = JSON.stringify({ raven: { kind: 'raven_hub', expires: '2036-01-01T00:00:00Z' } });
        expect(filterWarnings(p, null).map((r) => r.id)).toEqual(['r2']);
        // Another kind isn't a Raven.
        p.entities[1].description = JSON.stringify({ raven: { kind: 'tak_server' } });
        expect(filterWarnings(p, null).map((r) => r.id)).toEqual([]);
    });

    it('ignores filtered rules from non-Raven sources', () => {
        const p = samplePolicy();
        p.rules[1].filter.groupsFilterType = 'allowed';
        expect(filterWarnings(p, own.uid).map((r) => r.id)).toEqual(['r3']);
    });
});

describe('group splitting', () => {
    it('separates group-set ids from plain groups', () => {
        expect(splitGroups(['gs1', 'Blue', 'x'], samplePolicy().groupSets)).toEqual({ setIds: ['gs1'], plain: ['Blue', 'x'] });
    });
});

describe('outgoing connections', () => {
    it('validates host and port', () => {
        const f = { ...blankOutgoing(ids()), displayName: 'P', host: 'https://x.example' };
        expect(validateOutgoing(f).host).toBeTruthy();
        expect(validateOutgoing({ ...f, host: 'x.example:9102' }).host).toBeTruthy();
        expect(validateOutgoing({ ...f, host: 'x example' }).host).toBeTruthy();
        expect(validateOutgoing({ ...f, host: 'x.example', port: 70000 }).port).toBeTruthy();
        expect(validateOutgoing({ ...f, host: 'x.example' })).toEqual({});
        expect(validateOutgoing({ ...f, host: 'x.example', useToken: true }).token).toBeTruthy();
    });

    it('keeps the existing hub name on edit and generates one on create', () => {
        const created = outgoingEntity({ ...blankOutgoing(() => 'u1'), displayName: 'Partner', host: 'h' });
        expect(created.name).toBe('Partner_u1');
        expect(created.config?.token).toBeNull();
        const edited = outgoingEntity({ ...outgoingFormFromEntity(samplePolicy().entities[2]), displayName: 'Renamed' });
        expect(edited.name).toBe('Partner_x');
    });
});

describe('live state', () => {
    const p = samplePolicy();
    it('uses live connections, not config.enabled', () => {
        const out = p.entities[2];
        expect(entityLiveState(out, [], true)).toBe('not_connected');
        expect(entityLiveState(out, [{ connectionId: 'Partner_x-abc' }], true)).toBe('connected');
        expect(entityLiveState(out, [{ connectionId: 'z', remoteAddress: '10.0.0.5:9102' }], true)).toBe('connected');
        expect(entityLiveState(p.entities[1], [{ connectionId: 'q', groupIdentities: [theirs.uid] }], true)).toBe('connected');
        expect(entityLiveState({ ...out, config: { enabled: false } }, [], true)).toBe('disabled');
        expect(entityLiveState(out, [{ connectionId: 'Partner_x-abc' }], false)).toBe('not_active');
    });

    it('derives direction and spots the bridge', () => {
        expect(connectionDirection({ connectionId: 'a', localConnectionType: 'FEDERATION_HUB_CLIENT' })).toBe('outgoing');
        expect(connectionDirection({ connectionId: 'a', localConnectionType: 'FEDERATION_HUB_SERVER' })).toBe('incoming');
        expect(isBridgeConnection({ connectionId: 'raven-federate-ab12-1' })).toBe(true);
        expect(isBridgeConnection({ connectionId: 'Pub server_1' })).toBe(false);
    });
});

describe('display helpers', () => {
    it('hides -1 metrics', () => {
        expect(metricValue(-1)).toBeNull();
        expect(formatPercent(-1)).toBeNull();
        expect(formatPercent(0.256)).toBe('25.6%');
        expect(formatBytes(-1)).toBeNull();
        expect(formatBytes(2048)).toBe('2.0 KB');
        expect(formatBytes(0)).toBe('0 B');
    });

    it('formats fingerprints and masks secrets', () => {
        expect(formatFingerprint('fd5c14')).toBe('FD:5C:14');
        const m = maskSecret('eyJabcdefghijkWXYZ');
        expect(m).not.toContain('eyJ');
        expect(m.endsWith('WXYZ')).toBe(true);
        expect(maskSecret('short')).not.toContain('short');
        expect(isSecretKey('keystorePassword')).toBe(true);
        expect(isSecretKey('v2Port')).toBe(false);
    });
});

describe('tokens and save body', () => {
    it('adds and removes tokens', () => {
        const node = { id: 't', type: 'FederationTokenGroup', name: 'tg', config: { tokens: [] } };
        const added = withToken(node, { token: 'abc', expiration: -1 });
        expect(added.config?.tokens).toEqual([{ token: 'abc', expiration: -1 }]);
        expect(withoutToken(added, 'abc').config?.tokens).toEqual([]);
        expect(tokenFingerprint('Partner Hub', 5)).toBe('5_Partner_Hub_token_fingerprint');
    });

    it('keeps views/plugins and forces a version', () => {
        const fed = { ...blankFederation('X', own, ids()), version: '' };
        const body = buildSaveBody(fed, normalizePolicy({}));
        expect(body.version).toBe('v3');
        expect(body.views).toEqual(fed.views);
        expect(blankFederation('Y', own, ids()).policy?.entities?.[0]?.name).toBe(own.uid);
    });
});

describe('pollUntil', () => {
    const noSleep = () => Promise.resolve();
    it('resolves true once the check passes, treating throws as not yet', async () => {
        let n = 0;
        const ok = await pollUntil(async () => {
            n += 1;
            if (n < 3) { throw new Error('down'); }
            return true;
        }, { sleep: noSleep, intervalMs: 1, timeoutMs: 100, initialDelayMs: 0 });
        expect(ok).toBe(true);
        expect(n).toBe(3);
    });

    it('gives up after the timeout', async () => {
        const ok = await pollUntil(async () => false, { sleep: noSleep, intervalMs: 10, timeoutMs: 30, initialDelayMs: 0 });
        expect(ok).toBe(false);
    });

    it('stops when cancelled', async () => {
        const ok = await pollUntil(async () => false, { sleep: noSleep, isCancelled: () => true });
        expect(ok).toBe(false);
    });
});

describe('description metadata (server format, round-trip)', () => {
    const meta = JSON.stringify({ raven: { ca: 'CN=x-1', kind: 'raven_hub' } });

    it('reads Raven metadata and the note', () => {
        expect(nodeMeta({ description: meta })).toEqual({ ca: 'CN=x-1', kind: 'raven_hub' });
        expect(nodeMeta({ description: 'typed text' })).toEqual({});
        expect(nodeMeta({ description: '' })).toEqual({});
        expect(descriptionNote(meta)).toBe('');
        expect(descriptionNote(JSON.stringify({ note: 'hi', raven: {} }))).toBe('hi');
        expect(descriptionNote('plain')).toBe('plain');
    });

    it('editing the note keeps the metadata, sorted like the server writes it', () => {
        const next = withDescriptionNote(meta, 'Ops link');
        expect(JSON.parse(next)).toEqual({ note: 'Ops link', raven: { ca: 'CN=x-1', kind: 'raven_hub' } });
        expect(Object.keys(JSON.parse(next))).toEqual(['note', 'raven']);
        expect(nodeMeta({ description: withDescriptionNote(next, '') })).toEqual({ ca: 'CN=x-1', kind: 'raven_hub' });
        expect(JSON.parse(withDescriptionNote(next, ''))).not.toHaveProperty('note');
        expect(withDescriptionNote('old text', 'new text')).toBe('new text');
    });

    it('outgoingEntity keeps the description, unknown fields and unknown config keys', () => {
        const previous = {
            id: 'out', type: 'FederationOutgoing', name: 'Partner_x', displayName: 'Partner', description: meta,
            extra: 42, config: { host: '10.0.0.5', port: 9102, enabled: true, outgoing_uuid: 'u-1', futureKey: 'keep' },
        };
        const form = { ...outgoingFormFromEntity(previous), host: '10.0.0.6' };
        const e = outgoingEntity(form, previous);
        expect(e.description).toBe(meta);
        expect((e as unknown as { extra: number }).extra).toBe(42);
        expect(e.config).toMatchObject({ host: '10.0.0.6', futureKey: 'keep', outgoing_uuid: 'u-1' });
        expect(e.name).toBe('Partner_x');
        expect(outgoingEntity(blankOutgoing(ids())).description).toBe('');
    });
});

describe('own node guard', () => {
    it('treats a disabled own node as missing', () => {
        const p = samplePolicy();
        expect(ownNodeActive(p, own.uid)).toBe(true);
        p.entities[0].config = { enabled: false };
        expect(ownNodeActive(p, own.uid)).toBe(false);
        expect(ownNodeActive({ ...p, entities: p.entities.slice(1) }, own.uid)).toBe(false);
    });
});

describe('withGroupSets', () => {
    it('strips deleted sets from the saved rules', () => {
        const p = samplePolicy(); // r3 allows gs1 + Blue
        const next = withGroupSets(p, []);
        expect(next.groupSets).toEqual([]);
        expect(next.rules.find((r) => r.id === 'r3')!.filter.allowedGroups).toEqual(['Blue']);
        const kept = withGroupSets(p, [{ id: 'gs1', name: 'Renamed', groups: ['A', 'B'] }]);
        expect(kept.rules.find((r) => r.id === 'r3')!.filter.allowedGroups).toEqual(['gs1', 'Blue']);
        expect(kept.groupSets[0].name).toBe('Renamed');
    });
});

describe('addViewNodes', () => {
    it('places nodes that have no position, keeping existing ones', () => {
        const p = samplePolicy();
        const views = { graph: { nodes: [{ id: 'own', x: 10, y: 20 }], settings: { zoom: 1 } } };
        const out = addViewNodes(views, p);
        const nodes = out.graph!.nodes as { id: string; x: number; y: number }[];
        expect(nodes.map((n) => n.id)).toEqual(['own', 'p', 'out']);
        expect(nodes[0]).toEqual({ id: 'own', x: 10, y: 20 });
        expect(nodes[1].y).toBeGreaterThan(20);
        expect(out.graph!.settings).toEqual({ zoom: 1 });
        expect(addViewNodes(out, p).graph!.nodes).toEqual(nodes);
        expect((addViewNodes(undefined, p).graph!.nodes as unknown[]).length).toBe(3);
    });
});

describe('plugin routing', () => {
    it('new entries use the hub defaults and need a name', () => {
        expect(blankPluginRouting('p')).toMatchObject({ pluginName: 'p', sendByDefault: true, receiveByDefault: true, disabled: false, sendTo: [] });
        expect(pluginRoutingValid([blankPluginRouting('p')])).toBe(true);
        expect(pluginRoutingValid([blankPluginRouting('')])).toBe(false);
    });
});
