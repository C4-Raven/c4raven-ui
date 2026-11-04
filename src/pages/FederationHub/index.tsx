import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Checkbox,
    Code,
    Group,
    Modal,
    Paper,
    SimpleGrid,
    Skeleton,
    Stack,
    Table,
    Text,
    ThemeIcon,
    Title,
    Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconAffiliate,
    IconAlertTriangle,
    IconPlugConnectedX,
    IconArrowsLeftRight,
    IconCertificate,
    IconCircleCheck,
    IconCirclePlus,
    IconDownload,
    IconRefresh,
    IconShare,
    IconTrash,
    IconWand,
    IconX,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import FederationPolicyDiagram from '../../components/FederationPolicyDiagram';
import { EmptyState, extractError, PulseDot, Section } from '../ServerRequests/shared';
import { AdvancedSection } from './advanced';
import { deletePartner, getActivePolicy, getOverview, patchPartner, reconnectPartner, repairHub } from './api';
import CheckPanel from './CheckPanel';
import ConnectWizard, { HandoffButtons, useHandoffActions } from './ConnectWizard';
import { explainError, hubDown, ourAddressOf, problemColor, problemText, shortFingerprint, type PartnerErrorView } from './helpers';
import { Fingerprint, ServerErrorAlert } from './parts';
import PartnerCard from './PartnerCard';
import PartnerEditor from './PartnerEditor';
import type { ActivePolicy, Overview, Partner } from './types';

const POLL_MS = 10_000;

function HowItWorks() {
    const { t } = useTranslation();
    const items = [
        {
            icon: <IconCertificate size={18} />,
            title: t('1. Trust'),
            body: t('Both servers swap certificate authority (CA) files, so each one knows the other is genuine.'),
        },
        {
            icon: <IconArrowsLeftRight size={18} />,
            title: t('2. Connect'),
            body: t('One side dials the other. Only one side should, or the hub drops the duplicate connection.'),
        },
        {
            icon: <IconShare size={18} />,
            title: t('3. Share'),
            body: t('Choose what flows each way. Everything is the usual choice; this server\'s Groups page decides what leaves it.'),
        },
    ];
    return (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            {items.map((it) => (
                <Paper key={it.title} p="md" className="raven-surface raven-surface--tile">
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                        <ThemeIcon variant="light" radius="xl" size="lg">{it.icon}</ThemeIcon>
                        <div>
                            <Text fw={600} size="sm">{it.title}</Text>
                            <Text size="sm" c="dimmed">{it.body}</Text>
                        </div>
                    </Group>
                </Paper>
            ))}
        </SimpleGrid>
    );
}

function StatusItem({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Stack gap={2} style={{ minWidth: 0 }}>
            <Text size="xs" c="dimmed">{label}</Text>
            <div>{children}</div>
        </Stack>
    );
}

function StatusStrip({ overview, onRepair, repairing, repairError, onRetryRepair }: {
    overview: Overview;
    onRepair: () => void;
    repairing: boolean;
    repairError?: PartnerErrorView;
    onRetryRepair: () => void;
}) {
    const { t } = useTranslation();
    const actions = useHandoffActions();
    const { hub, own, bridge } = overview;
    const bridgeOk = bridge.enabled && own.connected;
    const bridgeText = !bridge.enabled
        ? t('Turned off in settings')
        : own.connected
            ? t('Connected')
            : bridge.service_state === 'active'
                ? t('Running, not connected')
                : t('Service {{state}}', { state: bridge.service_state || t('unknown') });
    return (
        <Paper p="md" className="raven-surface" radius="lg">
            <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
                <StatusItem label={t('Hub')}>
                    <Group gap={6} wrap="nowrap">
                        <PulseDot active={hub.reachable} color="var(--mantine-color-green-5)" />
                        <Text size="sm" fw={600}>{hub.reachable ? t('Reachable') : t('Not answering')}</Text>
                    </Group>
                    <Text size="xs" c="dimmed">{t('Active policy')} <Code>{hub.active_policy || t('none')}</Code></Text>
                </StatusItem>
                <StatusItem label={t('This hub\'s certificate')}>
                    <Group gap={6} wrap="nowrap">
                        <Text size="sm" fw={600} truncate>{own.nickname || t('Unnamed')}</Text>
                        <Tooltip label={t('Download our CA')}>
                            <ActionIcon variant="subtle" size="sm" aria-label={t('Download our CA')} onClick={actions.ownCa}>
                                <IconDownload size={14} />
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                    <Fingerprint sha256={own.sha256} />
                </StatusItem>
                <StatusItem label={t('Partners connect to')}>
                    {ourAddressOf(hub) ? <Code>{ourAddressOf(hub)}</Code> : <Text size="sm" c="dimmed">{t('Unknown: set the hub\'s address in settings')}</Text>}
                </StatusItem>
                <StatusItem label={t('This Raven\'s bridge')}>
                    <Group gap={6} wrap="nowrap">
                        <PulseDot active={bridgeOk} color="var(--mantine-color-green-5)" />
                        <Text size="sm" fw={600}>{bridgeText}</Text>
                    </Group>
                    <Text size="xs" c="dimmed">{t('Carries this server\'s devices to and from the hub')}</Text>
                </StatusItem>
            </SimpleGrid>
            {overview.problems?.length > 0 && (
                <Stack gap="xs" mt="md">
                    {overview.problems.filter((code) => code !== 'hub_unreachable' && code !== 'hub_error').map((code) => (
                        <Alert key={code} color={problemColor(code)} variant="light" icon={<IconAlertTriangle size={16} />} py="xs">
                            <Group justify="space-between" wrap="wrap" gap="sm">
                                <Text size="sm" style={{ flex: 1, minWidth: 200 }}>{problemText(code, t)}</Text>
                                {(code === 'own_ca_missing' || (code === 'no_active_policy' && !overview.problems.includes('own_ca_missing'))) && (
                                    <Button size="xs" color="red" radius="xl" leftSection={<IconWand size={14} />} loading={repairing} onClick={onRepair}>
                                        {t('Repair')}
                                    </Button>
                                )}
                            </Group>
                        </Alert>
                    ))}
                    {repairError && <ServerErrorAlert view={repairError} title={t('Repair failed')} onRetry={onRetryRepair} />}
                </Stack>
            )}
        </Paper>
    );
}

/** The overview answered, but the hub itself is down (hub.reachable false). */
function HubDownState({ overview, onRetry }: { overview: Overview; onRetry: () => void }) {
    const { t } = useTranslation();
    const code = overview.problems?.includes('hub_error') ? 'hub_error' : 'hub_unreachable';
    return (
        <Paper className="raven-surface" radius="lg" p="lg">
            <EmptyState
                icon={<IconPlugConnectedX size={26} />}
                color="red"
                title={code === 'hub_error' ? t('The Federation Hub answered with an error') : t('The Federation Hub is down')}
                description={problemText(code, t)}
                action={(
                    <Stack align="center" gap="xs" mt="sm">
                        {overview.error && <Code>{overview.error}</Code>}
                        <Text size="xs" c="dimmed">{t('Partners can\'t be shown or changed until it answers. The page keeps trying every 10 seconds. If it stays down, restart the federation hub service on the server.')}</Text>
                        <Button size="xs" variant="light" radius="xl" leftSection={<IconRefresh size={14} />} onClick={onRetry}>{t('Try again now')}</Button>
                    </Stack>
                )}
            />
        </Paper>
    );
}

export default function FederationHub() {
    const { t } = useTranslation();
    const isPhone = useMediaQuery('(max-width: 48em)');
    const [overview, setOverview] = useState<Overview | null>(null);
    const [loadError, setLoadError] = useState<string>();
    const [loading, setLoading] = useState(true);
    const [policy, setPolicy] = useState<ActivePolicy | null>(null);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [editing, setEditing] = useState<Partner | null>(null);
    const [checking, setChecking] = useState<Partner | null>(null);
    const [removing, setRemoving] = useState<Partner | null>(null);
    const [keepCa, setKeepCa] = useState(false);
    const [removeBusy, setRemoveBusy] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [repairing, setRepairing] = useState(false);
    const [repairError, setRepairError] = useState<PartnerErrorView>();
    const [showMap, setShowMap] = useState(true);
    const inFlight = useRef(false);

    const showError = useCallback(async (title: string, err: unknown) => {
        notifications.show({ title, message: await extractError(err), icon: <IconX size={16} />, color: 'red' });
    }, []);

    const loadPolicy = useCallback(() => {
        getActivePolicy().then(setPolicy).catch(() => setPolicy(null));
    }, []);

    const load = useCallback(async (withPolicy = false) => {
        if (inFlight.current) { return; }
        inFlight.current = true;
        try {
            setOverview(await getOverview());
            setLoadError(undefined);
        } catch (err) {
            setLoadError(await extractError(err) ?? t('The Federation Hub could not be reached'));
        } finally {
            inFlight.current = false;
            setLoading(false);
        }
        if (withPolicy) { loadPolicy(); }
    }, [loadPolicy, t]);

    useEffect(() => {
        load(true);
        const timer = setInterval(() => { if (!document.hidden) { load(); } }, POLL_MS);
        return () => clearInterval(timer);
    }, [load]);

    useEffect(() => { setShowMap(!isPhone); }, [isPhone]);

    const partners = useMemo(() => overview?.partners ?? [], [overview]);
    const allConnections = useMemo(
        () => [...partners.flatMap((p) => p.connections ?? []), ...(overview?.unattributed_connections ?? [])],
        [partners, overview],
    );

    const down = hubDown(overview);
    const handoffActions = useHandoffActions();

    function openPartner(id: string) {
        const p = partners.find((x) => x.id === id);
        setWizardOpen(false);
        if (p) {
            setEditing(p);
        } else {
            notifications.show({ color: 'yellow', title: t('Partner not found'), message: t('Refresh the page and look for it in the list.') });
        }
    }

    function replacePartner(id: string, p: Partner) {
        setOverview((o) => (o ? { ...o, partners: o.partners.map((x) => (x.id === id ? p : x)) } : o));
    }

    async function toggle(p: Partner, enabled: boolean) {
        setBusyId(p.id);
        replacePartner(p.id, { ...p, enabled, status: enabled ? p.status : 'disabled' });
        try {
            const saved = await patchPartner(p.id, { enabled });
            if (saved?.id) { replacePartner(p.id, saved); }
            loadPolicy();
        } catch (err) {
            replacePartner(p.id, p);
            showError(t('Failed to update partner'), err);
        } finally {
            setBusyId(null);
        }
    }

    async function reconnect(p: Partner) {
        setBusyId(p.id);
        try {
            const result = await reconnectPartner(p.id);
            notifications.show(result?.disconnected
                ? { color: 'green', title: t('Reconnecting'), message: t('{{name}}: {{count}} connection(s) dropped. They come back by themselves in a few seconds.', { name: p.name, count: result.disconnected }) }
                : { color: 'blue', title: t('Nothing to reconnect'), message: t('{{name}} has no live connection right now.', { name: p.name }) });
            setTimeout(() => load(), 3000);
        } catch (err) {
            showError(t('Failed to reconnect'), err);
        } finally {
            setBusyId(null);
        }
    }

    /** Both sides dial: drop our outgoing connection (outgoing-only: remove it, keeping any CA). */
    async function stopDialling(p: Partner) {
        setBusyId(p.id);
        try {
            if (p.ca) {
                const saved = await patchPartner(p.id, { direction: 'they_dial' });
                if (saved?.id) { replacePartner(p.id, saved); }
                notifications.show({ color: 'green', icon: <IconCircleCheck size={16} />, title: t('No longer connecting to them'), message: t('{{name}} now connects to us; this hub stopped dialling.', { name: p.name }) });
            } else {
                const result = await deletePartner(p.id, true);
                notifications.show({ color: result?.warning ? 'yellow' : 'green', icon: <IconCircleCheck size={16} />, title: t('Outgoing connection removed'), message: result?.warning ?? p.name });
            }
            load(true);
        } catch (err) {
            const v = await explainError(err, partners, t);
            notifications.show({ color: 'red', icon: <IconX size={16} />, title: t('Failed to change the connection'), message: v.message });
        } finally {
            setBusyId(null);
        }
    }

    async function confirmRemove() {
        if (!removing) { return; }
        setRemoveBusy(true);
        try {
            const result = await deletePartner(removing.id, keepCa);
            notifications.show(result?.warning
                ? { color: 'yellow', icon: <IconAlertTriangle size={16} />, title: t('Partner removed, certificate kept'), message: result.warning, autoClose: 12000 }
                : {
                    color: 'green',
                    icon: <IconCircleCheck size={16} />,
                    title: t('Partner removed'),
                    message: result?.ca_removed ? t('{{name}} and its certificate were removed.', { name: removing.name }) : removing.name,
                });
            setOverview((o) => (o ? { ...o, partners: o.partners.filter((x) => x.id !== removing.id) } : o));
            setRemoving(null);
            load(true);
        } catch (err) {
            const v = await explainError(err, partners, t);
            notifications.show({ color: 'red', icon: <IconX size={16} />, title: t('Failed to remove partner'), message: v.message });
        } finally {
            setRemoveBusy(false);
        }
    }

    async function repair() {
        setRepairing(true);
        setRepairError(undefined);
        try {
            const result = await repairHub();
            notifications.show(result?.changed === false
                ? { color: 'blue', title: t('Nothing to repair'), message: t('This hub\'s certificate is already in the active policy.') }
                : { color: 'green', icon: <IconCircleCheck size={16} />, title: t('Repaired'), message: t('This hub\'s certificate is back in the active policy.') });
            load(true);
        } catch (err) {
            setRepairError(await explainError(err, partners, t, t('Repair failed')));
        } finally {
            setRepairing(false);
        }
    }

    const entities = policy?.policy?.entities ?? [];
    const rules = policy?.policy?.rules ?? [];

    return (
        <Stack gap="lg">
            <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
                <div>
                    <Title order={2}>{t('Federation Hub')}</Title>
                    <Text size="sm" c="dimmed">{t('Share devices, chat and map data with other TAK servers')}</Text>
                </div>
                <Group gap="sm">
                    <Tooltip label={t('Refresh')}>
                        <ActionIcon variant="light" size="lg" radius="xl" aria-label={t('Refresh')} onClick={() => load(true)}>
                            <IconRefresh size={18} />
                        </ActionIcon>
                    </Tooltip>
                    <Button className="raven-cta" radius="xl" leftSection={<IconCirclePlus size={16} />} onClick={() => setWizardOpen(true)} disabled={!overview || down}>
                        {t('Connect a server')}
                    </Button>
                </Group>
            </Group>

            <HowItWorks />

            {loadError && (
                <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title={t('Can\'t reach the Federation Hub')}>
                    {loadError}
                    <Text size="xs" mt={4}>{t('The page keeps trying every 10 seconds.')}</Text>
                </Alert>
            )}

            {loading ? (
                <Skeleton height={110} radius="lg" />
            ) : overview && (
                <StatusStrip overview={overview} onRepair={repair} repairing={repairing} repairError={repairError} onRetryRepair={repair} />
            )}

            {loading ? (
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                    <Skeleton height={240} radius="lg" />
                    <Skeleton height={240} radius="lg" />
                </SimpleGrid>
            ) : overview && down ? (
                <HubDownState overview={overview} onRetry={() => load(true)} />
            ) : partners.length === 0 ? (
                <Paper className="raven-surface" radius="lg" p="lg">
                    <EmptyState
                        icon={<IconAffiliate size={26} />}
                        color="blue"
                        title={t('Not connected to any other server yet')}
                        description={t('Connect another Raven, a TAK Server or a federation hub so devices on both sides can see each other. The guide walks you and the other admin through it.')}
                        action={(
                            <Stack align="center" gap="sm" mt="sm">
                                <Button className="raven-cta" radius="xl" leftSection={<IconCirclePlus size={16} />} onClick={() => setWizardOpen(true)} disabled={!overview}>
                                    {t('Connect a server')}
                                </Button>
                                <HandoffButtons size="xs" />
                            </Stack>
                        )}
                    />
                </Paper>
            ) : (
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                    {partners.map((p) => (
                        <PartnerCard
                            key={p.id}
                            partner={p}
                            busy={busyId === p.id}
                            onEdit={() => setEditing(p)}
                            onCheck={() => setChecking(p)}
                            onReconnect={() => reconnect(p)}
                            onRemove={() => { setKeepCa(false); setRemoving(p); }}
                            onToggle={(enabled) => toggle(p, enabled)}
                            onStopDialling={() => stopDialling(p)}
                            onInstructions={() => handoffActions.handoff({ partnerId: p.id, kind: p.kind })}
                        />
                    ))}
                </SimpleGrid>
            )}

            {(overview?.unattributed_connections?.length ?? 0) > 0 && (
                <Section
                    title={t('Unrecognised connections')}
                    description={t('Connected to the hub but not matched to a partner above. This is often this Raven\'s own bridge, or a server whose certificate was trusted outside this page. Disconnect them from Advanced, Connections.')}
                >
                    <Table.ScrollContainer minWidth={560}>
                        <Table striped>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>{t('Server')}</Table.Th>
                                    <Table.Th>{t('Address')}</Table.Th>
                                    <Table.Th>{t('Direction')}</Table.Th>
                                    <Table.Th>{t('Certificate')}</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {overview!.unattributed_connections.map((c) => (
                                    <Table.Tr key={c.connectionId}>
                                        <Table.Td><Text size="sm" style={{ wordBreak: 'break-all' }}>{c.remoteServerId || c.connectionId}</Text></Table.Td>
                                        <Table.Td><Text size="sm">{c.remoteAddress || '—'}</Text></Table.Td>
                                        <Table.Td>
                                            <Badge variant="light" tt="none" color={c.localConnectionType === 'CLIENT' ? 'indigo' : 'grape'}>
                                                {c.localConnectionType === 'CLIENT' ? t('We dialled') : t('They dialled')}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                                                {(c.groupIdentities ?? []).map((g) => {
                                                    const m = /-([0-9a-fA-F:]{40,})$/.exec(g);
                                                    return m ? shortFingerprint(m[1]) : g;
                                                }).join(', ') || '—'}
                                            </Text>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                </Section>
            )}

            <Section
                title={t('Connection map')}
                description={t('The policy the hub is enforcing right now. To change it by hand, use the policy editor under Advanced.')}
                actions={(
                    <Button size="xs" variant="subtle" radius="xl" onClick={() => setShowMap((v) => !v)} aria-expanded={showMap}>
                        {showMap ? t('Hide map') : t('Show map')}
                    </Button>
                )}
            >
                {showMap && (policy ? (
                    <FederationPolicyDiagram
                        key={`${policy.name ?? ''}|${policy.modifiedDate ?? ''}|${entities.length}|${rules.length}`}
                        entities={entities}
                        rules={rules}
                        views={policy.views?.graph}
                        knownGroups={[]}
                        connections={allConnections}
                        readOnly
                    />
                ) : (
                    <Text size="sm" c="dimmed">{t('No active policy to show.')}</Text>
                ))}
            </Section>

            <AdvancedSection />

            <ConnectWizard
                opened={wizardOpen}
                onClose={() => { setWizardOpen(false); load(true); }}
                overview={overview}
                onCreated={() => load(true)}
                onOpenPartner={openPartner}
            />

            <PartnerEditor
                partner={editing}
                overview={overview}
                onClose={() => setEditing(null)}
                onOpenPartner={openPartner}
                onSaved={(p) => {
                    if (editing && p?.id) { replacePartner(editing.id, p); }
                    setEditing(null);
                    load(true);
                }}
            />

            <Modal
                opened={checking !== null}
                onClose={() => setChecking(null)}
                size="lg"
                fullScreen={isPhone}
                title={<Text fw={700}>{t('Check connection to {{name}}', { name: checking?.name ?? '' })}</Text>}
            >
                {checking && <CheckPanel partnerId={checking.id} />}
            </Modal>

            <Modal
                opened={removing !== null}
                onClose={() => setRemoving(null)}
                title={<Text fw={700}>{t('Remove {{name}}?', { name: removing?.name ?? '' })}</Text>}
                centered
            >
                <Stack gap="sm">
                    <Text size="sm">
                        {t('The hub stops exchanging data with this partner straight away, and the change is activated on the hub.')}
                    </Text>
                    <Checkbox
                        label={t('Keep their certificate trusted')}
                        description={t('Useful if you plan to reconnect them soon.')}
                        checked={keepCa}
                        onChange={(e) => setKeepCa(e.currentTarget.checked)}
                    />
                    <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />} py="xs">
                        {keepCa
                            ? t('Their certificate stays trusted, so other partners are not interrupted.')
                            : t('Their certificate is removed too. The hub then restarts its federation listener, so every other partner disconnects for a few seconds and reconnects by itself.')}
                    </Alert>
                </Stack>
                <Group justify="flex-end" mt="lg" gap="sm">
                    <Button variant="default" radius="xl" onClick={() => setRemoving(null)}>{t('Cancel')}</Button>
                    <Button color="red" radius="xl" leftSection={<IconTrash size={16} />} loading={removeBusy} onClick={confirmRemove}>
                        {t('Remove partner')}
                    </Button>
                </Group>
            </Modal>
        </Stack>
    );
}
