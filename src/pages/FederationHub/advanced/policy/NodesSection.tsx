import React, { useMemo, useState } from 'react';
import {
    ActionIcon,
    Badge,
    Button,
    Checkbox,
    Group,
    Menu,
    Modal,
    NumberInput,
    Select,
    Stack,
    Switch,
    Table,
    Text,
    TextInput,
    Tooltip,
} from '@mantine/core';
import { IconArrowsExchange, IconCertificate, IconChevronDown, IconEdit, IconKey, IconPlus, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { PulseDot } from '../../../ServerRequests/shared';
import {
    addCaToPolicy,
    blankOutgoing,
    connectionDirection,
    entityLabel,
    entityLiveState,
    makeTokenGroupEntity,
    outgoingFormFromEntity,
    removeEntities,
    shortFingerprint,
    tokenEntries,
    upsertEntity,
    type LiveState,
    type OutgoingForm,
} from '../helpers';
import { ConfirmModal } from '../shared';
import type { CaGroup, HubConnection, PolicyCore, PolicyEntity } from '../types';
import OutgoingModal from './OutgoingModal';

function LiveBadge({ state }: { state: LiveState }) {
    const { t } = useTranslation();
    switch (state) {
        case 'connected':
            return <Group gap={6} wrap="nowrap"><PulseDot active /><Text size="sm">{t('Connected')}</Text></Group>;
        case 'disabled':
            return <Badge color="gray" variant="light">{t('Disabled')}</Badge>;
        case 'not_active':
            return <Tooltip label={t('This policy isn\'t the active one, so the hub isn\'t using this node.')}><Badge color="gray" variant="outline">{t('Policy not active')}</Badge></Tooltip>;
        default:
            return <Group gap={6} wrap="nowrap"><PulseDot active={false} /><Text size="sm" c="dimmed">{t('Not connected')}</Text></Group>;
    }
}

function typeLabel(type: string, t: (k: string) => string) {
    if (type === 'FederationOutgoing') { return t('Outgoing'); }
    if (type === 'FederationTokenGroup') { return t('Token group'); }
    if (type === 'FederationGroup') { return t('CA group'); }
    return type;
}

export default function NodesSection({ policy, onChange, caGroups, connections, policyActive, ownCa }: {
    policy: PolicyCore;
    onChange: (p: PolicyCore) => void;
    caGroups: CaGroup[];
    connections: HubConnection[];
    policyActive: boolean;
    ownCa: CaGroup | null;
}) {
    const { t } = useTranslation();
    const [outgoingOpen, setOutgoingOpen] = useState(false);
    const [outgoingForm, setOutgoingForm] = useState<OutgoingForm>(() => blankOutgoing());
    const [editingOutgoing, setEditingOutgoing] = useState(false);

    const [caPickOpen, setCaPickOpen] = useState(false);
    const [caPick, setCaPick] = useState<string | null>(null);
    const [caWithRules, setCaWithRules] = useState(true);

    const [tokenOpen, setTokenOpen] = useState(false);
    const [tokenName, setTokenName] = useState('');

    const [editNode, setEditNode] = useState<PolicyEntity | null>(null);
    const [toDelete, setToDelete] = useState<PolicyEntity | null>(null);

    const caChoices = useMemo(() => caGroups
        .filter((c) => !policy.entities.some((e) => e.type === 'FederationGroup' && e.name === c.uid))
        .map((c) => ({ value: c.uid, label: `${c.nickname || t('(no nickname)')} · ${shortFingerprint(c.alias)}${c.hubGroup ? ` · ${t('this hub')}` : ''}` })), [caGroups, policy.entities, t]);

    const ruleCount = (id: string) => policy.rules.filter((r) => r.source === id || r.destination === id).length;

    function details(e: PolicyEntity) {
        const c = e.config ?? {};
        if (e.type === 'FederationOutgoing') {
            return (
                <Group gap={4}>
                    <Text size="sm" ff="monospace">{`${c.host ?? '?'}:${c.port ?? '?'}`}</Text>
                    <Badge size="xs" variant="light" color={c.tls ? 'blue' : 'orange'}>{c.tls ? 'TLS' : t('No TLS')}</Badge>
                    {c.useToken && <Badge size="xs" variant="light" color="grape">{t('Token')}</Badge>}
                </Group>
            );
        }
        if (e.type === 'FederationGroup') {
            const ca = caGroups.find((x) => x.uid === e.name);
            return (
                <Group gap={4}>
                    {ca ? <Text size="xs" ff="monospace">{shortFingerprint(ca.alias)}</Text> : <Badge size="xs" color="red" variant="light">{t('CA not trusted')}</Badge>}
                    {ca?.hubGroup && <Badge size="xs" color="blue" variant="light">{t('This hub')}</Badge>}
                    {c.interconnected && <Badge size="xs" variant="light">{t('Interconnected')}</Badge>}
                    {c.allowTokenAuth && <Badge size="xs" variant="light" color="grape">{t('Token auth')}</Badge>}
                </Group>
            );
        }
        if (e.type === 'FederationTokenGroup') {
            return <Text size="sm">{t('{{count}} token(s)', { count: tokenEntries(e).length })}</Text>;
        }
        return <Text size="sm" c="dimmed">—</Text>;
    }

    function openEdit(e: PolicyEntity) {
        if (e.type === 'FederationOutgoing') {
            setOutgoingForm(outgoingFormFromEntity(e));
            setEditingOutgoing(true);
            setOutgoingOpen(true);
        } else {
            setEditNode(e);
        }
    }

    function toggleEnabled(e: PolicyEntity, enabled: boolean) {
        onChange(upsertEntity(policy, { ...e, config: { ...(e.config ?? {}), enabled } }));
    }

    function addCaNode() {
        const ca = caGroups.find((c) => c.uid === caPick);
        if (!ca) { return; }
        if (caWithRules) {
            onChange(addCaToPolicy(policy, ca, ownCa));
        } else {
            onChange(addCaToPolicy(policy, ca, null));
        }
        setCaPickOpen(false);
        setCaPick(null);
    }

    const incomingFromHost = (host: string) => connections.some((c) => connectionDirection(c) === 'incoming'
        && !!c.remoteAddress && (c.remoteAddress === host || c.remoteAddress.startsWith(`${host}:`)));

    return (
        <Stack gap="xs">
            <Group justify="space-between" wrap="wrap">
                <div>
                    <Text fw={600}>{t('Nodes')}</Text>
                    <Text size="sm" c="dimmed">{t('Every CA group, outgoing connection and token group in this policy.')}</Text>
                </div>
                <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                        <Button size="xs" radius="xl" variant="light" leftSection={<IconPlus size={14} />} rightSection={<IconChevronDown size={14} />}>{t('Add node')}</Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                        <Menu.Item leftSection={<IconCertificate size={16} />} onClick={() => setCaPickOpen(true)}>{t('CA group (a trusted CA)')}</Menu.Item>
                        <Menu.Item leftSection={<IconArrowsExchange size={16} />} onClick={() => { setOutgoingForm(blankOutgoing()); setEditingOutgoing(false); setOutgoingOpen(true); }}>{t('Outgoing connection')}</Menu.Item>
                        <Menu.Item leftSection={<IconKey size={16} />} onClick={() => { setTokenName(''); setTokenOpen(true); }}>{t('Token group')}</Menu.Item>
                    </Menu.Dropdown>
                </Menu>
            </Group>

            <Table.ScrollContainer minWidth={820}>
                <Table striped withTableBorder>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>{t('Name')}</Table.Th>
                            <Table.Th>{t('Type')}</Table.Th>
                            <Table.Th>{t('Details')}</Table.Th>
                            <Table.Th>{t('Status')}</Table.Th>
                            <Table.Th>{t('Rules')}</Table.Th>
                            <Table.Th>{t('Enabled')}</Table.Th>
                            <Table.Th />
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {policy.entities.length === 0 && (
                            <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" ta="center" size="sm">{t('No nodes. Add this hub\'s own CA first, or nobody can connect.')}</Text></Table.Td></Table.Tr>
                        )}
                        {policy.entities.map((e) => (
                            <Table.Tr key={e.id}>
                                <Table.Td><Text size="sm" fw={600}>{entityLabel(e)}</Text></Table.Td>
                                <Table.Td><Badge variant="light" color={e.type === 'FederationOutgoing' ? 'indigo' : e.type === 'FederationTokenGroup' ? 'grape' : 'gray'}>{typeLabel(e.type, t)}</Badge></Table.Td>
                                <Table.Td>{details(e)}</Table.Td>
                                <Table.Td><LiveBadge state={entityLiveState(e, connections, policyActive)} /></Table.Td>
                                <Table.Td>{ruleCount(e.id)}</Table.Td>
                                <Table.Td>
                                    <Switch size="sm" checked={e.config?.enabled !== false} onChange={(ev) => toggleEnabled(e, ev.currentTarget.checked)} aria-label={t('Enabled')} />
                                </Table.Td>
                                <Table.Td>
                                    <Group gap={4} wrap="nowrap">
                                        <Tooltip label={t('Edit')}><ActionIcon variant="subtle" onClick={() => openEdit(e)} aria-label={t('Edit')}><IconEdit size={16} /></ActionIcon></Tooltip>
                                        <Tooltip label={t('Remove from policy')}><ActionIcon color="red" variant="subtle" onClick={() => setToDelete(e)} aria-label={t('Remove from policy')}><IconTrash size={16} /></ActionIcon></Tooltip>
                                    </Group>
                                </Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </Table.ScrollContainer>

            <OutgoingModal
                opened={outgoingOpen}
                initial={outgoingForm}
                editing={editingOutgoing}
                incomingFromSameHost={incomingFromHost}
                onClose={() => setOutgoingOpen(false)}
                onSave={(entity) => { onChange(upsertEntity(policy, entity)); setOutgoingOpen(false); }}
            />

            <Modal opened={caPickOpen} onClose={() => setCaPickOpen(false)} title={<Text fw={700}>{t('Add a CA group node')}</Text>} centered>
                <Stack gap="sm">
                    {caChoices.length === 0 ? (
                        <Text size="sm" c="dimmed">{t('Every trusted CA is already in this policy. Add a CA on the Certificates tab first.')}</Text>
                    ) : (
                        <Select label={t('Trusted CA')} data={caChoices} value={caPick} onChange={setCaPick} searchable />
                    )}
                    <Checkbox
                        checked={caWithRules}
                        onChange={(e) => setCaWithRules(e.currentTarget.checked)}
                        label={t('Add All-groups rules both ways with this hub\'s own CA')}
                        disabled={!ownCa}
                    />
                </Stack>
                <Group justify="flex-end" mt="lg" gap="sm">
                    <Button variant="default" radius="xl" onClick={() => setCaPickOpen(false)}>{t('Cancel')}</Button>
                    <Button radius="xl" disabled={!caPick} onClick={addCaNode}>{t('Add to draft')}</Button>
                </Group>
            </Modal>

            <Modal opened={tokenOpen} onClose={() => setTokenOpen(false)} title={<Text fw={700}>{t('Add a token group')}</Text>} centered>
                <Stack gap="sm">
                    <Text size="sm" c="dimmed">{t('For servers that can\'t use mutual TLS. After saving and applying, generate tokens for it on the Tokens tab. The broker also needs a token port configured.')}</Text>
                    <TextInput label={t('Name')} value={tokenName} onChange={(e) => setTokenName(e.currentTarget.value)} data-autofocus />
                </Stack>
                <Group justify="flex-end" mt="lg" gap="sm">
                    <Button variant="default" radius="xl" onClick={() => setTokenOpen(false)}>{t('Cancel')}</Button>
                    <Button
                        radius="xl"
                        disabled={!tokenName.trim() || policy.entities.some((e) => e.name === tokenName.trim())}
                        onClick={() => { onChange(upsertEntity(policy, makeTokenGroupEntity(tokenName))); setTokenOpen(false); }}
                    >
                        {t('Add to draft')}
                    </Button>
                </Group>
            </Modal>

            <NodeEditModal node={editNode} onClose={() => setEditNode(null)} onSave={(n) => { onChange(upsertEntity(policy, n)); setEditNode(null); }} />

            <ConfirmModal
                opened={toDelete !== null}
                onClose={() => setToDelete(null)}
                onConfirm={() => { if (toDelete) { onChange(removeEntities(policy, [toDelete.id]).policy); } setToDelete(null); }}
                title={t('Remove this node from the policy?')}
                confirmLabel={t('Remove from draft')}
            >
                <Text size="sm">
                    {t('"{{name}}" and the {{count}} rule(s) that touch it are removed from the draft. Nothing changes on the hub until you save and apply.', { name: entityLabel(toDelete ?? undefined), count: toDelete ? ruleCount(toDelete.id) : 0, interpolation: { escapeValue: false } })}
                </Text>
                {toDelete?.type === 'FederationGroup' && ownCa && toDelete.name === ownCa.uid && (
                    <Text size="sm" c="red">{t('This is the hub\'s own CA group. Without it this Raven\'s bridge is refused.')}</Text>
                )}
            </ConfirmModal>
        </Stack>
    );
}

function NodeEditModal({ node, onClose, onSave }: { node: PolicyEntity | null; onClose: () => void; onSave: (n: PolicyEntity) => void }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<PolicyEntity | null>(node);
    React.useEffect(() => { setDraft(node); }, [node]);
    if (!draft) { return null; }
    const c = draft.config ?? {};
    const setConfig = (patch: Record<string, unknown>) => setDraft({ ...draft, config: { ...c, ...patch } });
    const isCa = draft.type === 'FederationGroup';
    return (
        <Modal opened={node !== null} onClose={onClose} title={<Text fw={700}>{isCa ? t('Edit CA group node') : t('Edit node')}</Text>} centered>
            <Stack gap="sm">
                <TextInput label={t('Display name')} value={draft.displayName ?? ''} onChange={(e) => setDraft({ ...draft, displayName: e.currentTarget.value })} />
                {isCa ? (
                    <TextInput label={t('CA group id (uid)')} value={draft.name ?? ''} readOnly description={t('This can\'t be changed because it identifies the CA.')} />
                ) : (
                    <TextInput label={t('Name')} value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })} />
                )}
                <TextInput label={t('Description')} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.currentTarget.value })} />
                <Switch label={t('Enabled')} checked={c.enabled !== false} onChange={(e) => setConfig({ enabled: e.currentTarget.checked })} />
                {isCa && (
                    <>
                        <Switch
                            label={t('Interconnected')}
                            description={t('Lets servers whose certificates come from this same CA exchange data with each other (e.g. two Ravens using this hub\'s client certificates).')}
                            checked={!!c.interconnected}
                            onChange={(e) => setConfig({ interconnected: e.currentTarget.checked })}
                        />
                        <Switch
                            label={t('Allow automatic token authentication')}
                            description={t('Servers behind TLS-inspecting firewalls can get a token with their certificate. Needs a token port on the broker.')}
                            checked={!!c.allowTokenAuth}
                            onChange={(e) => setConfig({ allowTokenAuth: e.currentTarget.checked })}
                        />
                        {c.allowTokenAuth && (
                            <NumberInput
                                label={t('Token lifetime (seconds)')}
                                description={t('-1 = never expires')}
                                value={typeof c.tokenAuthDuration === 'number' ? c.tokenAuthDuration : -1}
                                onChange={(v) => setConfig({ tokenAuthDuration: Number(v) })}
                                min={-1}
                            />
                        )}
                    </>
                )}
            </Stack>
            <Group justify="flex-end" mt="lg" gap="sm">
                <Button variant="default" radius="xl" onClick={onClose}>{t('Cancel')}</Button>
                <Button radius="xl" disabled={!isCa && !(draft.name ?? '').trim()} onClick={() => onSave(draft)}>{t('Save to draft')}</Button>
            </Group>
        </Modal>
    );
}
