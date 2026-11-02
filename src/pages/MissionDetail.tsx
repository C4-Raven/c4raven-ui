import React, { useCallback, useEffect, useState } from 'react';
import {
    Anchor, Badge, Box, Button, Group, Loader, SimpleGrid, Stack, Table, Tabs, Text, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconArrowLeft, IconChevronRight, IconDatabase, IconFileZip, IconFiles, IconFolder,
    IconHistory, IconLink, IconMap2, IconMapPin, IconUsers, IconX,
} from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { Link, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import axios from '../axios_config';
import { apiRoutes } from '../apiRoutes';
import bytes_formatter from '../bytes_formatter';
import {
    EmptyState, Section, downloadFile, extractError, formatDateTime, formatRelative, humanize,
} from './ServerRequests/shared';

interface Role { type: string; permissions: string[] }
interface Subscriber { clientUid: string; username: string; createTime: string; role: Role }
interface Content {
    uid: string; name: string; hash: string; mimeType: string; size: number;
    submitter: string; submissionTime: string; creatorUid: string | null;
}
interface Item {
    uid: string; type: string | null; callsign: string | null; latitude: number | null;
    longitude: number | null; timestamp: string | null; stale: string | null; sender_uid: string | null;
}
interface UidEntry { data: string; details?: { callsign?: string | null; type?: string | null } }
interface Layer {
    uid: string; name: string; type: string; parentUid: string | null; creatorUid: string;
    createTime: string; children: Layer[]; uids: UidEntry[]; contents: { data: Content }[];
}
interface ExternalData { id: string; name: string; tool: string; urlData: string; urlView: string; notes: string }
interface Feed { uid: string; dataFeedUid: string; name: string; filterBbox: string; filterType: string; filterCallsign: string }
interface Change {
    type: string; timestamp: string; serverTime: string; creatorUid: string; contentUid: string | null;
    contentResource?: Content; details?: { callsign?: string | null; type?: string | null };
    externalData?: ExternalData; missionFeed?: Feed; missionLayer?: Layer;
}
interface LogEntry { id: string; content: string; creatorUid: string; dtg: string }
interface MissionInfo {
    name: string; description: string; tool: string; guid: string; createTime: string;
    defaultRole: Role; passwordProtected: boolean; inviteOnly: boolean; keywords: string[];
    owner: { callsign?: string; uid?: string } | null; groups: { id: number; name: string }[];
}
interface Detail {
    mission: MissionInfo; subscribers: Subscriber[]; contents: Content[]; items: Item[];
    layers: Layer[]; external_data: ExternalData[]; feeds: Feed[]; changes: Change[]; logs: LogEntry[];
}

const TABS = ['overview', 'contents', 'items', 'layers', 'external', 'changes'] as const;
type TabValue = (typeof TABS)[number];

function isTab(value: string | null): value is TabValue {
    return value !== null && (TABS as readonly string[]).includes(value);
}

const ROLE_COLOR: Record<string, string> = {
    MISSION_OWNER: 'grape',
    MISSION_SUBSCRIBER: 'blue',
    MISSION_READONLY_SUBSCRIBER: 'gray',
};

const CHANGE_COLOR: Record<string, string> = {
    ADD_CONTENT: 'green',
    REMOVE_CONTENT: 'red',
    CREATE_DATA_FEED: 'teal',
    DELETE_DATA_FEED: 'orange',
    ADD_MISSION_LAYER: 'cyan',
    UPDATE_MISSION_LAYER: 'blue',
    REMOVE_MISSION_LAYER: 'pink',
};

function changeSubject(change: Change): string {
    if (change.externalData) { return change.externalData.name || change.externalData.id; }
    if (change.missionFeed) { return change.missionFeed.name || change.missionFeed.dataFeedUid; }
    if (change.missionLayer) { return change.missionLayer.name; }
    if (change.contentResource) { return change.contentResource.name; }
    if (change.details?.callsign) { return change.details.callsign; }
    return change.contentUid ?? '';
}

function changeKind(change: Change, t: (key: string) => string): string {
    if (change.externalData) { return t('External data'); }
    if (change.missionFeed) { return t('Feed'); }
    if (change.missionLayer) { return t('Layer'); }
    if (change.contentResource && !change.details) { return t('File'); }
    if (change.details || change.contentUid) { return t('Map item'); }
    return '';
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Table.Tr>
            <Table.Th w={180}><Text size="sm" c="dimmed">{label}</Text></Table.Th>
            <Table.Td><Text size="sm" component="div">{children}</Text></Table.Td>
        </Table.Tr>
    );
}

function LayerNode({ layer, depth }: { layer: Layer; depth: number }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(true);
    const members = layer.uids.length + layer.contents.length;
    const expandable = layer.children.length > 0 || members > 0;

    return (
        <Box>
            <Group
                gap="xs"
                wrap="nowrap"
                py={4}
                pl={depth * 20}
                style={{ cursor: expandable ? 'pointer' : 'default' }}
                onClick={() => expandable && setOpen((o) => !o)}
            >
                <IconChevronRight
                    size={14}
                    style={{
                        visibility: expandable ? 'visible' : 'hidden',
                        transform: open ? 'rotate(90deg)' : undefined,
                        transition: 'transform 120ms ease',
                    }}
                />
                <IconFolder size={16} />
                <Text size="sm" fw={600}>{layer.name}</Text>
                <Badge size="xs" variant="light">{layer.type}</Badge>
                {members > 0 && <Text size="xs" c="dimmed">{t('{{count}} items', { count: members })}</Text>}
            </Group>
            {open && (
                <>
                    {layer.uids.map((entry) => (
                        <Group key={`uid-${entry.data}`} gap="xs" wrap="nowrap" py={2} pl={depth * 20 + 40}>
                            <IconMapPin size={14} />
                            <Text size="sm">{entry.details?.callsign || entry.data}</Text>
                            {entry.details?.type && <Text size="xs" c="dimmed">{entry.details.type}</Text>}
                        </Group>
                    ))}
                    {layer.contents.map((entry) => (
                        <Group key={`hash-${entry.data.hash}`} gap="xs" wrap="nowrap" py={2} pl={depth * 20 + 40}>
                            <IconFiles size={14} />
                            <Text size="sm">{entry.data.name}</Text>
                        </Group>
                    ))}
                    {layer.children.map((child) => <LayerNode key={child.uid} layer={child} depth={depth + 1} />)}
                </>
            )}
        </Box>
    );
}

export default function MissionDetail() {
    const { t } = useTranslation();
    const params = useParams();
    const name = params.name ?? '';
    const [searchParams, setSearchParams] = useSearchParams();
    const requested = searchParams.get('tab');
    const tab: TabValue = isTab(requested) ? requested : 'overview';
    const [detail, setDetail] = useState<Detail | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [downloading, setDownloading] = useState<'archive' | 'kml' | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        axios.get(apiRoutes.missionDetail, { params: { name } })
            .then((r) => { setDetail(r.data); setNotFound(false); })
            .catch(async (err) => {
                if (err?.response?.status === 404) {
                    setNotFound(true);
                } else {
                    notifications.show({
                        title: t('Failed to load mission'),
                        message: await extractError(err),
                        icon: <IconX />,
                        color: 'red',
                    });
                }
            })
            .finally(() => setLoading(false));
    }, [name, t]);

    useEffect(() => { load(); }, [load]);

    function download(kind: 'archive' | 'kml') {
        setDownloading(kind);
        const url = kind === 'archive' ? apiRoutes.missionArchive : apiRoutes.missionKml;
        downloadFile(url, { name }, `${name}.${kind === 'archive' ? 'zip' : 'kml'}`)
            .catch(async (err) => {
                notifications.show({
                    title: kind === 'archive' ? t('Failed to download the mission archive') : t('Failed to export KML'),
                    message: await extractError(err),
                    icon: <IconX />,
                    color: 'red',
                });
            })
            .finally(() => setDownloading(null));
    }

    function changeTab(value: string | null) {
        if (!isTab(value)) { return; }
        setSearchParams(value === 'overview' ? {} : { tab: value }, { replace: true });
    }

    const back = (
        <Anchor component={Link} to="/missions" size="sm">
            <Group gap={4}><IconArrowLeft size={14} />{t('Missions')}</Group>
        </Anchor>
    );

    if (loading && !detail) {
        return <Group justify="center" py="xl"><Loader /></Group>;
    }

    if (notFound || !detail) {
        return (
            <Stack gap="lg">
                {back}
                <EmptyState
                    icon={<IconX size={26} />}
                    title={t('Mission not found')}
                    description={t('It may have been deleted, or it belongs to a group you are not in.')}
                />
            </Stack>
        );
    }

    const { mission } = detail;

    return (
        <Stack gap="lg">
            {back}
            <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
                <div>
                    <Group gap="sm">
                        <Title order={2}>{mission.name}</Title>
                        {mission.passwordProtected && <Badge variant="light" color="yellow">{t('Password protected')}</Badge>}
                        {mission.inviteOnly && <Badge variant="light" color="gray">{t('Invite only')}</Badge>}
                    </Group>
                    <Text size="sm" c="dimmed">{mission.description || t('No description')}</Text>
                </div>
                <Group gap="sm">
                    <Button
                        leftSection={<IconFileZip size={16} />}
                        loading={downloading === 'archive'}
                        onClick={() => download('archive')}
                    >{t('Download archive')}</Button>
                    <Button
                        variant="light"
                        leftSection={<IconMap2 size={16} />}
                        loading={downloading === 'kml'}
                        onClick={() => download('kml')}
                    >{t('Export KML')}</Button>
                </Group>
            </Group>

            <Tabs value={tab} onChange={changeTab} variant="pills" radius="xl">
                <Tabs.List mb="lg">
                    <Tabs.Tab value="overview" leftSection={<IconUsers size={16} />}>{t('Overview')}</Tabs.Tab>
                    <Tabs.Tab value="contents" leftSection={<IconFiles size={16} />}>
                        {t('Files')} ({detail.contents.length})
                    </Tabs.Tab>
                    <Tabs.Tab value="items" leftSection={<IconMapPin size={16} />}>
                        {t('Map items')} ({detail.items.length})
                    </Tabs.Tab>
                    <Tabs.Tab value="layers" leftSection={<IconFolder size={16} />}>{t('Layers')}</Tabs.Tab>
                    <Tabs.Tab value="external" leftSection={<IconLink size={16} />}>
                        {t('External data & feeds')}
                    </Tabs.Tab>
                    <Tabs.Tab value="changes" leftSection={<IconHistory size={16} />}>{t('Change log')}</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="overview">
                    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
                        <Section title={t('Mission')}>
                            <Table>
                                <Table.Tbody>
                                    <InfoRow label={t('GUID')}><Text size="sm" ff="monospace">{mission.guid || '—'}</Text></InfoRow>
                                    <InfoRow label={t('Tool')}>{mission.tool}</InfoRow>
                                    <InfoRow label={t('Owner')}>{mission.owner?.callsign || mission.owner?.uid || '—'}</InfoRow>
                                    <InfoRow label={t('Created')}>{formatDateTime(mission.createTime)}</InfoRow>
                                    <InfoRow label={t('Default role')}>{humanize(mission.defaultRole?.type)}</InfoRow>
                                    <InfoRow label={t('Groups')}>
                                        {mission.groups.length
                                            ? <Group gap={4}>{mission.groups.map((g) => <Badge key={g.id} variant="light">{g.name}</Badge>)}</Group>
                                            : '—'}
                                    </InfoRow>
                                    <InfoRow label={t('Keywords')}>{mission.keywords.length ? mission.keywords.join(', ') : '—'}</InfoRow>
                                </Table.Tbody>
                            </Table>
                        </Section>
                        <Section title={t('Subscribers')} description={t('Devices subscribed to this mission and their roles')}>
                            {detail.subscribers.length === 0
                                ? <EmptyState icon={<IconUsers size={26} />} title={t('No subscribers')} />
                                : (
                                    <DataTable
                                        records={detail.subscribers}
                                        idAccessor="clientUid"
                                        striped
                                        columns={[
                                            { accessor: 'username', title: t('User') },
                                            { accessor: 'clientUid', title: t('Device UID') },
                                            {
                                                accessor: 'role',
                                                title: t('Role'),
                                                render: (s) => (
                                                    <Badge variant="light" color={ROLE_COLOR[s.role.type] ?? 'gray'}>
                                                        {humanize(s.role.type.replace(/^MISSION_/, ''))}
                                                    </Badge>
                                                ),
                                            },
                                            { accessor: 'createTime', title: t('Since'), render: (s) => formatDateTime(s.createTime) },
                                        ]}
                                    />
                                )}
                        </Section>
                    </SimpleGrid>
                    {detail.logs.length > 0 && (
                        <Box mt="lg">
                            <Section title={t('Mission log')}>
                                <DataTable
                                    records={detail.logs}
                                    striped
                                    columns={[
                                        { accessor: 'dtg', title: t('Time'), render: (l) => formatDateTime(l.dtg) },
                                        { accessor: 'creatorUid', title: t('Author') },
                                        { accessor: 'content', title: t('Entry') },
                                    ]}
                                />
                            </Section>
                        </Box>
                    )}
                </Tabs.Panel>

                <Tabs.Panel value="contents">
                    <Section title={t('Files')}>
                        {detail.contents.length === 0
                            ? <EmptyState icon={<IconFiles size={26} />} title={t('No files in this mission')} />
                            : (
                                <DataTable
                                    records={detail.contents}
                                    idAccessor="hash"
                                    striped
                                    columns={[
                                        { accessor: 'name', title: t('Name') },
                                        { accessor: 'mimeType', title: t('Type') },
                                        { accessor: 'size', title: t('Size'), render: (c) => (c.size ? bytes_formatter(c.size) : '—') },
                                        { accessor: 'submitter', title: t('Submitted by') },
                                        { accessor: 'submissionTime', title: t('Submitted'), render: (c) => formatDateTime(c.submissionTime) },
                                    ]}
                                />
                            )}
                    </Section>
                </Tabs.Panel>

                <Tabs.Panel value="items">
                    <Section title={t('Map items')} description={t('Markers, shapes and routes in the mission, as they are in the KML export')}>
                        {detail.items.length === 0
                            ? <EmptyState icon={<IconMapPin size={26} />} title={t('No map items in this mission')} />
                            : (
                                <DataTable
                                    records={detail.items}
                                    idAccessor="uid"
                                    striped
                                    columns={[
                                        { accessor: 'callsign', title: t('Name'), render: (i) => i.callsign || i.uid },
                                        { accessor: 'type', title: t('Type'), render: (i) => <Text size="sm" ff="monospace">{i.type || '—'}</Text> },
                                        {
                                            accessor: 'latitude',
                                            title: t('Location'),
                                            render: (i) => (i.latitude != null && i.longitude != null
                                                ? `${i.latitude.toFixed(5)}, ${i.longitude.toFixed(5)}` : '—'),
                                        },
                                        { accessor: 'timestamp', title: t('Updated'), render: (i) => (i.timestamp ? formatRelative(i.timestamp) : '—') },
                                    ]}
                                />
                            )}
                    </Section>
                </Tabs.Panel>

                <Tabs.Panel value="layers">
                    <Section title={t('Layers')} description={t('The folder tree Data Sync clients show for this mission')}>
                        {detail.layers.length === 0
                            ? <EmptyState icon={<IconFolder size={26} />} title={t('No layers')} description={t('Mission owners can add folders from ATAK Data Sync.')} />
                            : detail.layers.map((layer) => <LayerNode key={layer.uid} layer={layer} depth={0} />)}
                    </Section>
                </Tabs.Panel>

                <Tabs.Panel value="external">
                    <Stack gap="lg">
                        <Section title={t('External data')} description={t('Links to data kept outside this server')}>
                            {detail.external_data.length === 0
                                ? <EmptyState icon={<IconLink size={26} />} title={t('No external data')} />
                                : (
                                    <DataTable
                                        records={detail.external_data}
                                        striped
                                        columns={[
                                            { accessor: 'name', title: t('Name') },
                                            { accessor: 'tool', title: t('Tool') },
                                            {
                                                accessor: 'urlView',
                                                title: t('Links'),
                                                render: (d) => (
                                                    <Group gap="sm">
                                                        {d.urlView && <Anchor size="sm" href={d.urlView} target="_blank" rel="noopener noreferrer">{t('View')}</Anchor>}
                                                        {d.urlData && <Anchor size="sm" href={d.urlData} target="_blank" rel="noopener noreferrer">{t('Data')}</Anchor>}
                                                    </Group>
                                                ),
                                            },
                                            { accessor: 'notes', title: t('Notes') },
                                        ]}
                                    />
                                )}
                        </Section>
                        <Section title={t('Feeds')} description={t('Data feeds subscribed to this mission')}>
                            {detail.feeds.length === 0
                                ? <EmptyState icon={<IconDatabase size={26} />} title={t('No feeds')} />
                                : (
                                    <DataTable
                                        records={detail.feeds}
                                        idAccessor="uid"
                                        striped
                                        columns={[
                                            { accessor: 'name', title: t('Name') },
                                            { accessor: 'dataFeedUid', title: t('Feed') },
                                            { accessor: 'filterType', title: t('Types'), render: (f) => f.filterType || '—' },
                                            { accessor: 'filterCallsign', title: t('Callsign'), render: (f) => f.filterCallsign || '—' },
                                            { accessor: 'filterBbox', title: t('Area'), render: (f) => f.filterBbox || '—' },
                                        ]}
                                    />
                                )}
                        </Section>
                    </Stack>
                </Tabs.Panel>

                <Tabs.Panel value="changes">
                    <Section title={t('Change log')} description={t('Everything added to or removed from the mission, newest first')}>
                        {detail.changes.length === 0
                            ? <EmptyState icon={<IconHistory size={26} />} title={t('No changes yet')} />
                            : (
                                <DataTable
                                    records={detail.changes.map((c, i) => ({ ...c, id: i }))}
                                    striped
                                    columns={[
                                        { accessor: 'serverTime', title: t('Time'), render: (c) => formatDateTime(c.serverTime || c.timestamp) },
                                        {
                                            accessor: 'type',
                                            title: t('Change'),
                                            render: (c) => <Badge variant="light" color={CHANGE_COLOR[c.type] ?? 'gray'}>{humanize(c.type)}</Badge>,
                                        },
                                        { accessor: 'kind', title: t('What'), render: (c) => changeKind(c, t) },
                                        { accessor: 'subject', title: t('Name'), render: (c) => changeSubject(c) },
                                        { accessor: 'creatorUid', title: t('By'), render: (c) => c.creatorUid || '—' },
                                    ]}
                                />
                            )}
                    </Section>
                </Tabs.Panel>
            </Tabs>
        </Stack>
    );
}
