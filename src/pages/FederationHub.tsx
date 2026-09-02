import {
    ActionIcon,
    Badge,
    Button,
    Card,
    Center,
    CopyButton,
    FileInput,
    Group,
    JsonInput,
    LoadingOverlay,
    Modal,
    NumberInput,
    PinInput,
    SimpleGrid,
    Stack,
    Switch,
    Table,
    Tabs,
    TagsInput,
    Text,
    TextInput,
    Title,
    Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import React, { useEffect, useState } from 'react';
import axios from '../axios_config';
import { apiRoutes } from '../apiRoutes';
import { t } from 'i18next';
import FederationPolicyDiagram from '../components/FederationPolicyDiagram';
import {
    IconAffiliate,
    IconCertificate,
    IconCheck,
    IconDownload,
    IconEdit,
    IconExternalLink,
    IconPlug,
    IconPlugConnectedX,
    IconPlus,
    IconRefresh,
    IconServerBolt,
    IconTrash,
    IconX,
} from '@tabler/icons-react';

// Matches tak.server.federation.hub.broker.HubConnectionInfo exactly (decompiled
// from the installed jar) -- this version's API doesn't expose read/processed
// counts or per-connection group mappings the way older Federation Hub releases did.
interface HubConnection {
    connectionId: string;
    localConnectionType?: string;
    remoteConnectionType?: string;
    remoteServerId?: string;
    federationProtocolVersion?: number;
    groupIdentities?: string[];
    remoteAddress?: string;
}

interface BrokerMetrics {
    totalMessagesDropped: number;
    totalWrites: number;
    totalReads: number;
    totalBytesWritten: number;
    totalBytesRead: number;
    channelInfos: unknown[];
}

interface BrokerGlobalMetrics {
    heapAllocated: number;
    heapUtilized: number;
    cpuUtilized: number;
    cpuCores: number;
    numConnectedClients: number;
    writesPerSecond: number;
    readsPerSecond: number;
    bytesWrittenPerSecond: number;
    bytesReadPerSecond: number;
}

interface CaGroup {
    alias: string;
    nickname: string;
    uid: string;
    issuer: string;
    subject: string;
    hubGroup: boolean;
}

interface Federation {
    name: string;
    version: string;
    description: string;
    creationDate: string;
    modifiedDate: string;
    policy: unknown;
    plugins: unknown[];
    views?: { graph?: { nodes?: unknown; settings?: Record<string, number> } };
}

// The other half of "how do servers federate together": a FederationGroup
// entity represents a CA-trust group accepting inbound connections (that's
// the CA Groups tab above); a FederationOutgoing entity is how this hub
// actively dials out to a remote hub's broker to establish federation.
interface PolicyEntity {
    id: string;
    type: string;
    displayName?: string;
    name?: string;
    description?: string;
    config?: Record<string, unknown>;
}

interface OutgoingForm {
    id: string;
    displayName: string;
    host: string;
    port: number;
    tls: boolean;
    enabled: boolean;
    useToken: boolean;
    tokenType: string;
    token: string;
}

const EMPTY_OUTGOING_FORM: OutgoingForm = {
    id: '',
    displayName: '',
    host: '',
    port: 9102,
    tls: true,
    enabled: true,
    useToken: false,
    tokenType: '',
    token: '',
};

function showError(title: string, err: any) {
    notifications.show({
        title,
        message: err?.response?.data?.error || err?.message || String(err),
        icon: <IconX />,
        color: 'red',
    });
}

export default function FederationHub() {
    const [loading, setLoading] = useState(false);
    const [connections, setConnections] = useState<HubConnection[]>([]);
    const [brokerMetrics, setBrokerMetrics] = useState<BrokerMetrics | null>(null);
    const [globalMetrics, setGlobalMetrics] = useState<BrokerGlobalMetrics | null>(null);
    const [plugins, setPlugins] = useState<any[]>([]);
    const [caGroups, setCaGroups] = useState<CaGroup[]>([]);
    const [federations, setFederations] = useState<Federation[]>([]);

    const [showAddCa, setShowAddCa] = useState(false);
    const [caFile, setCaFile] = useState<File | null>(null);
    const [caNickname, setCaNickname] = useState('');
    const [caUidToDelete, setCaUidToDelete] = useState('');
    const [showDeleteCa, setShowDeleteCa] = useState(false);

    const [selectedFederation, setSelectedFederation] = useState<Federation | null>(null);
    const [policyJson, setPolicyJson] = useState('{}');
    const [showRestartBroker, setShowRestartBroker] = useState(false);

    const [showOutgoingModal, setShowOutgoingModal] = useState(false);
    const [outgoingForm, setOutgoingForm] = useState<OutgoingForm>(EMPTY_OUTGOING_FORM);
    const [editingOutgoing, setEditingOutgoing] = useState(false);

    const [showGroupSetModal, setShowGroupSetModal] = useState(false);
    const [editingGroupSet, setEditingGroupSet] = useState(false);
    const [groupSetForm, setGroupSetForm] = useState<{ id: string; name: string; groups: string[] }>({ id: '', name: '', groups: [] });

    const [showAdminCertModal, setShowAdminCertModal] = useState(false);
    const [adminCert2faCode, setAdminCert2faCode] = useState('');
    const [adminCert2faVerified, setAdminCert2faVerified] = useState(false);
    const [adminCertPassword, setAdminCertPassword] = useState('');
    const [verifying2fa, setVerifying2fa] = useState(false);

    useEffect(() => {
        loadAll();
    }, []);

    function loadAll() {
        setLoading(true);
        Promise.allSettled([
            axios.get(apiRoutes.fedhubConnections),
            axios.get(apiRoutes.fedhubMetrics),
            axios.get(apiRoutes.fedhubPlugins),
            axios.get(apiRoutes.fedhubCaGroups),
            axios.get(apiRoutes.fedhubFederations),
        ]).then(([conn, metrics, plug, ca, feds]) => {
            if (conn.status === 'fulfilled') setConnections(conn.value.data);
            if (metrics.status === 'fulfilled') {
                setBrokerMetrics(metrics.value.data.broker);
                setGlobalMetrics(metrics.value.data.global);
            }
            if (plug.status === 'fulfilled') setPlugins(plug.value.data);
            if (ca.status === 'fulfilled') setCaGroups(ca.value.data);
            if (feds.status === 'fulfilled') setFederations(feds.value.data);

            const failed = [conn, metrics, plug, ca, feds].find((r) => r.status === 'rejected');
            if (failed && failed.status === 'rejected') {
                showError(t('Failed to reach Federation Hub'), failed.reason);
            }
            setLoading(false);
        });
    }

    function addCaGroup() {
        if (!caFile) {
            return;
        }
        const formData = new FormData();
        formData.append('file', caFile);
        formData.append('nickname', caNickname);
        axios
            .post(apiRoutes.fedhubCaGroups, formData)
            .then(() => {
                notifications.show({ title: t('CA added'), message: '', icon: <IconCheck />, color: 'green' });
                setShowAddCa(false);
                setCaFile(null);
                setCaNickname('');
                loadAll();
            })
            .catch((err) => showError(t('Failed to add CA'), err));
    }

    function deleteCaGroup() {
        axios
            .delete(`${apiRoutes.fedhubCaGroups}/${encodeURIComponent(caUidToDelete)}`)
            .then(() => {
                notifications.show({ title: t('CA removed'), message: '', icon: <IconCheck />, color: 'green' });
                setShowDeleteCa(false);
                loadAll();
            })
            .catch((err) => showError(t('Failed to remove CA'), err));
    }

    function renameCaGroup(ca: CaGroup, nickname: string) {
        axios
            .patch(apiRoutes.fedhubCaGroups, { ...ca, nickname })
            .then(() => {
                notifications.show({ title: t('CA updated'), message: '', icon: <IconCheck />, color: 'green' });
                loadAll();
            })
            .catch((err) => showError(t('Failed to rename CA'), err));
    }

    function openFederation(fed: Federation) {
        setSelectedFederation(fed);
        setPolicyJson(JSON.stringify(fed.policy ?? {}, null, 2));
    }

    function downloadSelfCa() {
        axios
            .get(apiRoutes.fedhubSelfCa, { responseType: 'blob' })
            .then((r) => {
                const url = window.URL.createObjectURL(new Blob([r.data]));
                const link = document.createElement('a');
                link.href = url;
                link.download = 'federation-hub-ca.pem';
                link.click();
                window.URL.revokeObjectURL(url);
            })
            .catch((err) => showError(t('Failed to download CA'), err));
    }

    function getEntities(): PolicyEntity[] {
        try {
            return JSON.parse(policyJson).entities || [];
        } catch {
            return [];
        }
    }

    function setEntities(entities: PolicyEntity[]) {
        let policy: any = {};
        try {
            policy = JSON.parse(policyJson);
        } catch {
            policy = {};
        }
        policy.entities = entities;
        setPolicyJson(JSON.stringify(policy, null, 2));
    }

    function getRules(): any[] {
        try {
            return JSON.parse(policyJson).rules || [];
        } catch {
            return [];
        }
    }

    function setRules(rules: any[]) {
        let policy: any = {};
        try {
            policy = JSON.parse(policyJson);
        } catch {
            policy = {};
        }
        policy.rules = rules;
        setPolicyJson(JSON.stringify(policy, null, 2));
    }

    // Named, reusable groups of CA group identities -- Federation Hub's policy
    // schema already carries these (policy.groupSets), the diagram just never
    // exposed a way to manage them from here before.
    function getGroupSets(): { id: string; name: string; groups: string[] }[] {
        try {
            return JSON.parse(policyJson).groupSets || [];
        } catch {
            return [];
        }
    }

    function setGroupSets(groupSets: { id: string; name: string; groups: string[] }[]) {
        let policy: any = {};
        try {
            policy = JSON.parse(policyJson);
        } catch {
            policy = {};
        }
        policy.groupSets = groupSets;
        setPolicyJson(JSON.stringify(policy, null, 2));
    }

    function openAddOutgoing() {
        setOutgoingForm({ ...EMPTY_OUTGOING_FORM, id: crypto.randomUUID() });
        setEditingOutgoing(false);
        setShowOutgoingModal(true);
    }

    function openEditOutgoing(entity: PolicyEntity) {
        const config = entity.config || {};
        setOutgoingForm({
            id: entity.id,
            displayName: entity.displayName || entity.name || '',
            host: (config.host as string) || '',
            port: (config.port as number) || 9102,
            tls: config.tls !== false,
            enabled: config.enabled !== false,
            useToken: !!config.useToken,
            tokenType: (config.tokenType as string) || '',
            token: (config.token as string) || '',
        });
        setEditingOutgoing(true);
        setShowOutgoingModal(true);
    }

    function saveOutgoing() {
        if (!outgoingForm.host || !outgoingForm.displayName) {
            notifications.show({
                title: t('Missing fields'),
                message: t('Display name and host are required'),
                icon: <IconX />,
                color: 'red',
            });
            return;
        }

        const entity: PolicyEntity = {
            id: outgoingForm.id,
            type: 'FederationOutgoing',
            displayName: outgoingForm.displayName,
            name: outgoingForm.displayName,
            config: {
                host: outgoingForm.host,
                port: outgoingForm.port,
                tls: outgoingForm.tls,
                enabled: outgoingForm.enabled,
                useToken: outgoingForm.useToken,
                tokenType: outgoingForm.tokenType,
                token: outgoingForm.token,
                outgoing_uuid: outgoingForm.id,
            },
        };

        const existing = getEntities();
        const updated = editingOutgoing
            ? existing.map((e) => (e.id === entity.id ? entity : e))
            : [...existing, entity];
        setEntities(updated);
        setShowOutgoingModal(false);
        notifications.show({
            title: t('Partner added to policy draft'),
            message: t('Click Save Policy to apply it'),
            icon: <IconCheck />,
            color: 'blue',
        });
    }

    function deleteEntity(id: string) {
        setEntities(getEntities().filter((e) => e.id !== id));
    }

    function openAddGroupSet() {
        setGroupSetForm({ id: crypto.randomUUID(), name: '', groups: [] });
        setEditingGroupSet(false);
        setShowGroupSetModal(true);
    }

    function openEditGroupSet(set: { id: string; name: string; groups: string[] }) {
        setGroupSetForm(set);
        setEditingGroupSet(true);
        setShowGroupSetModal(true);
    }

    function saveGroupSet() {
        if (!groupSetForm.name) {
            notifications.show({ title: t('Missing name'), message: '', icon: <IconX />, color: 'red' });
            return;
        }
        const existing = getGroupSets();
        const updated = editingGroupSet
            ? existing.map((s) => (s.id === groupSetForm.id ? groupSetForm : s))
            : [...existing, groupSetForm];
        setGroupSets(updated);
        setShowGroupSetModal(false);
        notifications.show({
            title: t('Group set saved to policy draft'),
            message: t('Click Save Policy to apply it'),
            icon: <IconCheck />,
            color: 'blue',
        });
    }

    function deleteGroupSet(id: string) {
        setGroupSets(getGroupSets().filter((s) => s.id !== id));
    }

    function savePolicy() {
        if (!selectedFederation) {
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(policyJson);
        } catch {
            notifications.show({ title: t('Invalid JSON'), message: '', icon: <IconX />, color: 'red' });
            return;
        }
        // FederationUIPolicyModel nests entities/rules/groupSets under "policy",
        // keyed by the federation's own "name" (there's no separate id field).
        axios
            .post(apiRoutes.fedhubPolicy, { name: selectedFederation.name, policy: parsed })
            .then(() => {
                notifications.show({ title: t('Policy saved'), message: '', icon: <IconCheck />, color: 'green' });
                loadAll();
            })
            .catch((err) => showError(t('Failed to save policy'), err));
    }

    function saveViews(graph: { nodes?: unknown; settings?: Record<string, number> }) {
        if (!selectedFederation) {
            return;
        }
        axios
            .post(`${apiRoutes.fedhubPolicy}/view`, { name: selectedFederation.name, views: { graph } })
            .catch((err) => showError(t('Failed to save layout'), err));
    }

    function disconnectConnection(connectionId: string) {
        axios
            .delete(`${apiRoutes.fedhubConnections}/${encodeURIComponent(connectionId)}`)
            .then(() => {
                notifications.show({ title: t('Disconnected'), message: '', icon: <IconCheck />, color: 'green' });
                loadAll();
            })
            .catch((err) => showError(t('Failed to disconnect'), err));
    }

    function restartBroker() {
        axios
            .post(apiRoutes.fedhubRestartBroker)
            .then(() => {
                notifications.show({ title: t('Broker restarting'), message: '', icon: <IconCheck />, color: 'green' });
                setShowRestartBroker(false);
                setTimeout(loadAll, 3000);
            })
            .catch((err) => showError(t('Failed to restart broker'), err));
    }

    function openAdminCertModal() {
        setAdminCert2faCode('');
        setAdminCert2faVerified(false);
        setAdminCertPassword('');
        setShowAdminCertModal(true);
    }

    function verifyAdminCert2fa() {
        setVerifying2fa(true);
        axios
            .post(apiRoutes.fedhubAdminCertVerify2fa, { code: adminCert2faCode })
            .then(() => {
                setVerifying2fa(false);
                setAdminCert2faVerified(true);
                return axios.get(apiRoutes.fedhubAdminCertPassword);
            })
            .then((r) => setAdminCertPassword(r?.data?.password || ''))
            .catch((err) => {
                setVerifying2fa(false);
                showError(t('Verification failed'), err);
            });
    }

    function downloadAdminCert() {
        axios
            .get(apiRoutes.fedhubAdminCert, { responseType: 'blob' })
            .then((r) => {
                const url = window.URL.createObjectURL(new Blob([r.data]));
                const link = document.createElement('a');
                link.href = url;
                link.download = 'fedhub-admin.p12';
                link.click();
                window.URL.revokeObjectURL(url);
            })
            .catch((err) => showError(t('Failed to download certificate'), err));
    }

    return (
        <>
            <LoadingOverlay visible={loading} zIndex={1000} overlayProps={{ radius: 'sm', blur: 2 }} />

            <Group justify="space-between" mb="md">
                <Title order={2}>{t('Federation Hub')}</Title>
                <Group>
                    <Tooltip label={t('Refresh')}>
                        <ActionIcon variant="default" onClick={loadAll}>
                            <IconRefresh size={18} />
                        </ActionIcon>
                    </Tooltip>
                    <Button
                        component="a"
                        href="https://fed.c4raven.net:9100"
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="default"
                        leftSection={<IconExternalLink size={16} />}
                    >
                        {t('Open Native Admin Panel')}
                    </Button>
                    <Button
                        variant="default"
                        leftSection={<IconCertificate size={16} />}
                        onClick={openAdminCertModal}
                    >
                        {t('Get Admin Certificate')}
                    </Button>
                    <Button
                        color="red"
                        variant="light"
                        leftSection={<IconServerBolt size={16} />}
                        onClick={() => setShowRestartBroker(true)}
                    >
                        {t('Restart Broker')}
                    </Button>
                </Group>
            </Group>

            <Tabs defaultValue="status">
                <Tabs.List>
                    <Tabs.Tab value="status" leftSection={<IconServerBolt size={16} />}>
                        {t('Status')}
                    </Tabs.Tab>
                    <Tabs.Tab value="ca_groups" leftSection={<IconPlug size={16} />}>
                        {t('CA Groups')}
                    </Tabs.Tab>
                    <Tabs.Tab value="federations" leftSection={<IconAffiliate size={16} />}>
                        {t('Federations')}
                    </Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="status" pt="md">
                    <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">
                        <Card className="raven-surface raven-surface--tile">
                            <Text size="xs" c="dimmed">{t('Connected Clients')}</Text>
                            <Text size="xl" fw={700}>{globalMetrics?.numConnectedClients ?? '-'}</Text>
                        </Card>
                        <Card className="raven-surface raven-surface--tile">
                            <Text size="xs" c="dimmed">{t('CPU Utilized')}</Text>
                            <Text size="xl" fw={700}>
                                {globalMetrics && globalMetrics.cpuUtilized >= 0 ? `${(globalMetrics.cpuUtilized * 100).toFixed(1)}%` : '-'}
                            </Text>
                        </Card>
                        <Card className="raven-surface raven-surface--tile">
                            <Text size="xs" c="dimmed">{t('Heap Utilized')}</Text>
                            <Text size="xl" fw={700}>
                                {globalMetrics && globalMetrics.heapUtilized >= 0 ? `${(globalMetrics.heapUtilized * 100).toFixed(1)}%` : '-'}
                            </Text>
                        </Card>
                        <Card className="raven-surface raven-surface--tile">
                            <Text size="xs" c="dimmed">{t('Messages Dropped')}</Text>
                            <Text size="xl" fw={700}>{brokerMetrics?.totalMessagesDropped ?? '-'}</Text>
                        </Card>
                    </SimpleGrid>

                    <Title order={4} mb="xs">{t('Active Connections')}</Title>
                    <Table.ScrollContainer minWidth={700} mb="md">
                        <Table striped highlightOnHover withTableBorder>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>{t('Federate')}</Table.Th>
                                    <Table.Th>{t('Remote Address')}</Table.Th>
                                    <Table.Th>{t('Type')}</Table.Th>
                                    <Table.Th>{t('Protocol Version')}</Table.Th>
                                    <Table.Th>{t('Groups')}</Table.Th>
                                    <Table.Th>{t('Manage')}</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {connections.length === 0 && (
                                    <Table.Tr>
                                        <Table.Td colSpan={6}><Text c="dimmed" ta="center">{t('No active connections')}</Text></Table.Td>
                                    </Table.Tr>
                                )}
                                {connections.map((c) => (
                                    <Table.Tr key={c.connectionId}>
                                        <Table.Td>{c.remoteServerId || c.connectionId}</Table.Td>
                                        <Table.Td>{c.remoteAddress ?? '-'}</Table.Td>
                                        <Table.Td>
                                            <Badge variant="light">
                                                {c.localConnectionType === 'CLIENT' ? t('Outgoing') : t('Incoming')}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td>{c.federationProtocolVersion ?? '-'}</Table.Td>
                                        <Table.Td>{c.groupIdentities?.length ? c.groupIdentities.join(', ') : '-'}</Table.Td>
                                        <Table.Td>
                                            <Tooltip label={t('Disconnect')}>
                                                <ActionIcon color="red" variant="subtle" onClick={() => disconnectConnection(c.connectionId)}>
                                                    <IconPlugConnectedX size={16} />
                                                </ActionIcon>
                                            </Tooltip>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                    <Text size="xs" c="dimmed" mb="md">
                        {t('This Federation Hub version doesn\'t expose per-connection read/processed message counts over its API (older Federation Hub releases did) -- Broker Metrics above covers aggregate throughput instead.')}
                    </Text>

                    <Title order={4} mb="xs">{t('Registered Plugins')}</Title>
                    <Table.ScrollContainer minWidth={400}>
                        <Table striped highlightOnHover withTableBorder>
                            <Table.Tbody>
                                {plugins.length === 0 && (
                                    <Table.Tr>
                                        <Table.Td><Text c="dimmed" ta="center">{t('No registered plugins')}</Text></Table.Td>
                                    </Table.Tr>
                                )}
                                {plugins.map((p, i) => (
                                    <Table.Tr key={i}>
                                        <Table.Td>{JSON.stringify(p)}</Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                </Tabs.Panel>

                <Tabs.Panel value="ca_groups" pt="md">
                    <Text size="sm" c="dimmed" mb="md">
                        {t('To federate, both sides must trust each other\'s CA. Download our CA below and send it to a partner so they can add it as a trusted CA on their hub; add their CA here so we trust connections from them.')}
                    </Text>
                    <Group justify="flex-end" mb="md">
                        <Button variant="default" leftSection={<IconDownload size={16} />} onClick={downloadSelfCa}>
                            {t('Download Our CA')}
                        </Button>
                        <Button leftSection={<IconPlus size={16} />} onClick={() => setShowAddCa(true)}>
                            {t('Add CA')}
                        </Button>
                    </Group>
                    <Table.ScrollContainer minWidth={600}>
                        <Table striped highlightOnHover withTableBorder>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>{t('Nickname')}</Table.Th>
                                    <Table.Th>{t('Subject')}</Table.Th>
                                    <Table.Th>{t('Hub Group')}</Table.Th>
                                    <Table.Th />
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {caGroups.map((ca) => (
                                    <Table.Tr key={ca.uid}>
                                        <Table.Td>
                                            <TextInput
                                                defaultValue={ca.nickname}
                                                onBlur={(e) => {
                                                    if (e.currentTarget.value !== ca.nickname) {
                                                        renameCaGroup(ca, e.currentTarget.value);
                                                    }
                                                }}
                                            />
                                        </Table.Td>
                                        <Table.Td>{ca.subject}</Table.Td>
                                        <Table.Td>
                                            <Badge color={ca.hubGroup ? 'blue' : 'gray'}>{ca.hubGroup ? t('Yes') : t('No')}</Badge>
                                        </Table.Td>
                                        <Table.Td>
                                            <Tooltip label={t('Remove')}>
                                                <ActionIcon
                                                    color="red"
                                                    variant="subtle"
                                                    onClick={() => {
                                                        setCaUidToDelete(ca.uid);
                                                        setShowDeleteCa(true);
                                                    }}
                                                >
                                                    <IconTrash size={16} />
                                                </ActionIcon>
                                            </Tooltip>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                </Tabs.Panel>

                <Tabs.Panel value="federations" pt="md">
                    <Stack gap="md">
                        <Table.ScrollContainer minWidth={600}>
                            <Table striped highlightOnHover withTableBorder>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>{t('Name')}</Table.Th>
                                        <Table.Th>{t('Version')}</Table.Th>
                                        <Table.Th>{t('Description')}</Table.Th>
                                        <Table.Th>{t('Last Modified')}</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {federations.map((f) => (
                                        <Table.Tr
                                            key={f.name}
                                            onClick={() => openFederation(f)}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            <Table.Td>{f.name}</Table.Td>
                                            <Table.Td>{f.version}</Table.Td>
                                            <Table.Td>{f.description}</Table.Td>
                                            <Table.Td>{f.modifiedDate ? new Date(f.modifiedDate).toLocaleString() : '-'}</Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </Table.ScrollContainer>

                        {selectedFederation && (
                            <Card className="raven-surface">
                                <Group justify="space-between" mb="xs">
                                    <Title order={4}>{t('Outgoing Connection Configuration')}</Title>
                                    <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={openAddOutgoing}>
                                        {t('Create Outgoing Connection')}
                                    </Button>
                                </Group>
                                <Text size="sm" c="dimmed" mb="xs">
                                    {t('Has this hub actively dial out to a remote hub\'s broker to establish federation with them. Trusted incoming CAs are configured separately under the CA Groups tab.')}
                                </Text>
                                <Table.ScrollContainer minWidth={600} mb="md">
                                    <Table striped highlightOnHover withTableBorder>
                                        <Table.Thead>
                                            <Table.Tr>
                                                <Table.Th>{t('Name')}</Table.Th>
                                                <Table.Th>{t('Address')}</Table.Th>
                                                <Table.Th>{t('Port')}</Table.Th>
                                                <Table.Th>{t('TLS')}</Table.Th>
                                                <Table.Th>{t('Status')}</Table.Th>
                                                <Table.Th>{t('Manage')}</Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {getEntities().filter((e) => e.type === 'FederationOutgoing').length === 0 && (
                                                <Table.Tr>
                                                    <Table.Td colSpan={6}><Text c="dimmed" ta="center">{t('No outgoing connections configured')}</Text></Table.Td>
                                                </Table.Tr>
                                            )}
                                            {getEntities().filter((e) => e.type === 'FederationOutgoing').map((e) => (
                                                <Table.Tr key={e.id}>
                                                    <Table.Td>{e.displayName || e.name}</Table.Td>
                                                    <Table.Td>{(e.config?.host as string) ?? '-'}</Table.Td>
                                                    <Table.Td>{(e.config?.port as number) ?? '-'}</Table.Td>
                                                    <Table.Td>
                                                        <Badge color={e.config?.tls ? 'blue' : 'gray'} variant="light">
                                                            {e.config?.tls ? t('Yes') : t('No')}
                                                        </Badge>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Badge color={e.config?.enabled ? 'green' : 'gray'}>
                                                            {e.config?.enabled ? t('Enabled') : t('Disabled')}
                                                        </Badge>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Group gap="xs">
                                                            <Tooltip label={t('Edit')}>
                                                                <ActionIcon variant="subtle" onClick={() => openEditOutgoing(e)}>
                                                                    <IconEdit size={16} />
                                                                </ActionIcon>
                                                            </Tooltip>
                                                            <Tooltip label={t('Delete')}>
                                                                <ActionIcon color="red" variant="subtle" onClick={() => deleteEntity(e.id)}>
                                                                    <IconTrash size={16} />
                                                                </ActionIcon>
                                                            </Tooltip>
                                                        </Group>
                                                    </Table.Td>
                                                </Table.Tr>
                                            ))}
                                        </Table.Tbody>
                                    </Table>
                                </Table.ScrollContainer>

                                <Group justify="space-between" mb="xs">
                                    <Title order={4}>{t('Group Sets')}</Title>
                                    <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={openAddGroupSet}>
                                        {t('Create Group Set')}
                                    </Button>
                                </Group>
                                <Text size="sm" c="dimmed" mb="xs">
                                    {t('Named, reusable lists of CA group identities -- pick a set instead of retyping the same groups into every rule\'s Allowed/Disallowed lists.')}
                                </Text>
                                {getGroupSets().length === 0 ? (
                                    <Text size="sm" c="dimmed" mb="md">{t('No group sets yet')}</Text>
                                ) : (
                                    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} mb="md">
                                        {getGroupSets().map((set) => (
                                            <Card key={set.id} withBorder radius="md" p="sm" className="raven-surface raven-surface--tile">
                                                <Group justify="space-between" wrap="nowrap" mb={4}>
                                                    <Text fw={600} size="sm" truncate>{set.name}</Text>
                                                    <Group gap={4}>
                                                        <ActionIcon size="sm" variant="subtle" onClick={() => openEditGroupSet(set)}>
                                                            <IconEdit size={14} />
                                                        </ActionIcon>
                                                        <ActionIcon size="sm" color="red" variant="subtle" onClick={() => deleteGroupSet(set.id)}>
                                                            <IconTrash size={14} />
                                                        </ActionIcon>
                                                    </Group>
                                                </Group>
                                                {set.groups.length === 0 ? (
                                                    <Text size="xs" c="dimmed">{t('No groups in this set')}</Text>
                                                ) : (
                                                    <Group gap={4}>
                                                        {set.groups.map((g) => (
                                                            <Badge key={g} size="sm" variant="light" color="indigo">{g}</Badge>
                                                        ))}
                                                    </Group>
                                                )}
                                            </Card>
                                        ))}
                                    </SimpleGrid>
                                )}

                                <Title order={4}>{t('Connection Map')}</Title>
                                <Text size="sm" c="dimmed" mb="sm">
                                    {t('How this federation routes data between your CA groups and outgoing connections.')}
                                </Text>
                                <FederationPolicyDiagram
                                    entities={getEntities()}
                                    rules={getRules()}
                                    views={selectedFederation.views?.graph}
                                    knownGroups={caGroups.map((ca) => ca.nickname || ca.alias)}
                                    onRulesChange={setRules}
                                    onViewsChange={saveViews}
                                />

                                <Title order={5} mt="lg" mb="xs">{t('Advanced: Raw Policy JSON')}</Title>
                                <JsonInput
                                    value={policyJson}
                                    onChange={setPolicyJson}
                                    minRows={12}
                                    autosize
                                    formatOnBlur
                                    validationError={t('Invalid JSON')}
                                />
                                <Group justify="flex-end" mt="md">
                                    <Button onClick={savePolicy}>{t('Save Policy')}</Button>
                                </Group>
                            </Card>
                        )}
                    </Stack>
                </Tabs.Panel>
            </Tabs>

            <Modal opened={showAddCa} onClose={() => setShowAddCa(false)} title={t('Add CA')}>
                <FileInput
                    mb="md"
                    label={t('CA certificate file')}
                    value={caFile}
                    onChange={setCaFile}
                    clearable
                />
                <TextInput
                    mb="md"
                    label={t('Nickname')}
                    value={caNickname}
                    onChange={(e) => setCaNickname(e.currentTarget.value)}
                />
                <Group justify="flex-end">
                    <Button variant="default" onClick={() => setShowAddCa(false)}>{t('Cancel')}</Button>
                    <Button onClick={addCaGroup} disabled={!caFile}>{t('Add')}</Button>
                </Group>
            </Modal>

            <Modal opened={showDeleteCa} onClose={() => setShowDeleteCa(false)} title={t('Remove CA')}>
                <Text mb="md">{t('Are you sure you want to remove this CA? Partners using it will lose federation access.')}</Text>
                <Group justify="flex-end">
                    <Button variant="default" onClick={() => setShowDeleteCa(false)}>{t('Cancel')}</Button>
                    <Button color="red" onClick={deleteCaGroup}>{t('Remove')}</Button>
                </Group>
            </Modal>

            <Modal opened={showRestartBroker} onClose={() => setShowRestartBroker(false)} title={t('Restart Broker')}>
                <Text mb="md">{t('This will disconnect all active federation partners while the broker restarts. Continue?')}</Text>
                <Group justify="flex-end">
                    <Button variant="default" onClick={() => setShowRestartBroker(false)}>{t('Cancel')}</Button>
                    <Button color="red" onClick={restartBroker}>{t('Restart')}</Button>
                </Group>
            </Modal>

            <Modal opened={showAdminCertModal} onClose={() => setShowAdminCertModal(false)} title={t('Get Admin Certificate')}>
                {!adminCert2faVerified ? (
                    <Stack gap="md">
                        <Text size="sm" c="dimmed">
                            {t('This certificate lets you log into the native Federation Hub panel. Confirm your identity with a 2FA code before it\'s issued.')}
                        </Text>
                        <Center>
                            <PinInput
                                length={6}
                                type="number"
                                value={adminCert2faCode}
                                onChange={setAdminCert2faCode}
                            />
                        </Center>
                        <Group justify="flex-end">
                            <Button variant="default" onClick={() => setShowAdminCertModal(false)}>{t('Cancel')}</Button>
                            <Button loading={verifying2fa} disabled={adminCert2faCode.length < 6} onClick={verifyAdminCert2fa}>
                                {t('Verify')}
                            </Button>
                        </Group>
                    </Stack>
                ) : (
                    <Stack gap="md">
                        <Text size="sm">{t('Import password (also required in your browser/OS certificate store):')}</Text>
                        <Group gap="xs">
                            <TextInput value={adminCertPassword} readOnly style={{ flex: 1 }} />
                            <CopyButton value={adminCertPassword}>
                                {({ copied, copy }) => (
                                    <Button variant="default" onClick={copy}>{copied ? t('Copied') : t('Copy')}</Button>
                                )}
                            </CopyButton>
                        </Group>
                        <Group justify="flex-end">
                            <Button variant="default" onClick={() => setShowAdminCertModal(false)}>{t('Close')}</Button>
                            <Button leftSection={<IconDownload size={16} />} onClick={downloadAdminCert}>
                                {t('Download Certificate')}
                            </Button>
                        </Group>
                    </Stack>
                )}
            </Modal>

            <Modal
                key={outgoingForm.id}
                opened={showOutgoingModal}
                onClose={() => setShowOutgoingModal(false)}
                title={editingOutgoing ? t('Edit Outgoing Connection') : t('Add Outgoing Connection')}
            >
                <Stack gap="sm">
                    <TextInput
                        label={t('Display Name')}
                        placeholder={t('e.g. Partner Org Hub')}
                        value={outgoingForm.displayName}
                        onChange={(e) => setOutgoingForm({ ...outgoingForm, displayName: e.currentTarget.value })}
                        required
                    />
                    <TextInput
                        label={t('Host')}
                        placeholder="fedhub.partner.example.com"
                        value={outgoingForm.host}
                        onChange={(e) => setOutgoingForm({ ...outgoingForm, host: e.currentTarget.value })}
                        required
                    />
                    <NumberInput
                        label={t('Port')}
                        description={t('The remote hub\'s v1 (9101) or v2 (9102) broker port')}
                        value={outgoingForm.port}
                        onChange={(v) => setOutgoingForm({ ...outgoingForm, port: Number(v) || 0 })}
                        min={1}
                        max={65535}
                    />
                    <Switch
                        label={t('Use TLS')}
                        checked={outgoingForm.tls}
                        onChange={(e) => setOutgoingForm({ ...outgoingForm, tls: e.currentTarget.checked })}
                    />
                    <Switch
                        label={t('Enabled')}
                        checked={outgoingForm.enabled}
                        onChange={(e) => setOutgoingForm({ ...outgoingForm, enabled: e.currentTarget.checked })}
                    />
                    <Switch
                        label={t('Use token authentication')}
                        checked={outgoingForm.useToken}
                        onChange={(e) => setOutgoingForm({ ...outgoingForm, useToken: e.currentTarget.checked })}
                    />
                    {outgoingForm.useToken && (
                        <>
                            <TextInput
                                label={t('Token Type')}
                                value={outgoingForm.tokenType}
                                onChange={(e) => setOutgoingForm({ ...outgoingForm, tokenType: e.currentTarget.value })}
                            />
                            <TextInput
                                label={t('Token')}
                                value={outgoingForm.token}
                                onChange={(e) => setOutgoingForm({ ...outgoingForm, token: e.currentTarget.value })}
                            />
                        </>
                    )}
                </Stack>
                <Group justify="flex-end" mt="md">
                    <Button variant="default" onClick={() => setShowOutgoingModal(false)}>{t('Cancel')}</Button>
                    <Button onClick={saveOutgoing}>{editingOutgoing ? t('Save') : t('Add')}</Button>
                </Group>
            </Modal>

            <Modal
                key={groupSetForm.id}
                opened={showGroupSetModal}
                onClose={() => setShowGroupSetModal(false)}
                title={editingGroupSet ? t('Edit Group Set') : t('Create Group Set')}
            >
                <Stack gap="sm">
                    <TextInput
                        label={t('Name')}
                        placeholder={t('e.g. Trusted Partners')}
                        value={groupSetForm.name}
                        onChange={(e) => setGroupSetForm({ ...groupSetForm, name: e.currentTarget.value })}
                        required
                    />
                    <TagsInput
                        label={t('Groups')}
                        data={caGroups.map((ca) => ca.nickname || ca.alias)}
                        value={groupSetForm.groups}
                        onChange={(v) => setGroupSetForm({ ...groupSetForm, groups: v })}
                    />
                </Stack>
                <Group justify="flex-end" mt="md">
                    <Button variant="default" onClick={() => setShowGroupSetModal(false)}>{t('Cancel')}</Button>
                    <Button onClick={saveGroupSet}>{editingGroupSet ? t('Save') : t('Create')}</Button>
                </Group>
            </Modal>
        </>
    );
}
