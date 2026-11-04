import { describe, expect, it, vi } from 'vitest';
import { render, screen, userEvent, waitFor } from '@test-utils';
import { Notifications } from '@mantine/notifications';

const own = { alias: 'aa11', nickname: 'Us', uid: 'CN=Hub-aa11', issuer: 'CN=Hub', subject: 'CN=Hub', hubGroup: true };
const policy = {
    name: 'Tak',
    version: 'v3',
    modifiedDate: '2026-11-04T10:00:00Z',
    policy: {
        entities: [
            { id: 'own', type: 'FederationGroup', name: own.uid, displayName: 'Us', config: { enabled: true } },
            { id: 'tg', type: 'FederationTokenGroup', name: 'tokens', displayName: 'Tokens', config: { enabled: true, tokens: [{ token: 'eyJsecretTOKEN1234', expiration: -1 }] } },
        ],
        rules: [],
        groupSets: [],
    },
    plugins: [],
    views: { graph: { nodes: [], settings: { zoom: 1 } } },
};

const responses: Record<string, unknown> = {
    '/api/fedhub/connections': [{ connectionId: 'raven-federate-ab-1', remoteServerId: 'raven-federate', groupIdentities: [own.uid], localConnectionType: 'FEDERATION_HUB_SERVER', remoteConnectionType: 'FEDERATION_HUB_CLIENT' }],
    '/api/fedhub/metrics': { broker: { totalWrites: 5, channelInfos: [] }, global: { heapUtilized: -1, cpuUtilized: -1, numConnectedClients: 1 } },
    '/api/fedhub/plugins': [{ name: 'p1', type: 'SENDER', version: '1' }],
    '/api/fedhub/ca_groups': [own],
    '/api/fedhub/federations': [policy],
    '/api/fedhub/federations/Tak': policy,
    '/api/fedhub/policy': policy,
    '/api/fedhub/config': { v2Port: 9102, keystorePassword: null, clientTimeoutTime: 3600, federationTokenAuthServers: [] },
    '/api/fedhub/native_url': { url: 'https://hub.example:9100' },
};

vi.mock('../../../axios_config', () => ({
    default: {
        get: vi.fn((url: string) => (url in responses ? Promise.resolve({ data: responses[url], headers: {} }) : Promise.reject(new Error(`unmocked ${url}`)))),
        post: vi.fn(() => Promise.resolve({ data: {} })),
        patch: vi.fn(() => Promise.resolve({ data: {} })),
        delete: vi.fn(() => Promise.resolve({ data: {} })),
    },
}));

import { AdvancedSection } from './index';

describe('AdvancedSection', () => {
    it('is collapsed by default and every tab renders', async () => {
        render(<><Notifications /><AdvancedSection /></>);
        expect(screen.queryByText('Connections')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Show' }));
        expect(await screen.findByText('raven-federate')).toBeInTheDocument();
        expect(screen.getByText('This Raven')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('tab', { name: /Metrics/ }));
        expect((await screen.findAllByText('Not reported')).length).toBeGreaterThan(0);

        await userEvent.click(screen.getByRole('tab', { name: /Certificates/ }));
        expect(await screen.findByText('This hub')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('tab', { name: /Policy editor/ }));
        await userEvent.click(await screen.findByText('Tak'));
        expect(await screen.findByText('Saved')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('tab', { name: /Tokens/ }));
        await waitFor(() => expect(screen.getByText(/1234$/)).toBeInTheDocument());
        expect(screen.queryByText('eyJsecretTOKEN1234')).toBeNull();

        await userEvent.click(screen.getByRole('tab', { name: /Plugins/ }));
        expect(await screen.findByText('p1')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('tab', { name: /Broker/ }));
        expect(await screen.findByText('hidden')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('tab', { name: /Admin access/ }));
        expect(await screen.findByText('https://hub.example:9100')).toBeInTheDocument();
    });
});
