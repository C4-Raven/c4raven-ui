import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Alert,
    Badge,
    Button,
    Group,
    Paper,
    Select,
    Stack,
    Table,
    Text,
    TextInput,
    Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconCalendar,
    IconCircleCheck,
    IconCircleX,
    IconDownload,
    IconRefresh,
    IconSearch,
    IconShieldX,
    IconX,
} from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import {
    downloadFile,
    EmptyState,
    extractError,
    formatDateTime,
    formatRelative,
    humanize,
    Section,
} from './shared';

interface AdminEvent {
    id: number;
    timestamp: string;
    category: string;
    action: string;
    summary: string | null;
    username: string | null;
    actor: string | null;
    ip: string | null;
    user_agent: string | null;
    success: boolean;
    details: string | null;
}

interface AdminEventsResponse {
    generated_at: string;
    days: number;
    total: number;
    events: AdminEvent[];
    actors: string[];
    actions: { action: string; label: string | null }[];
}

const EVENTS_PER_PAGE = 50;
const LIMIT = 2000;

/** "2026-11-02" (a local calendar day) -> the UTC instant that day starts, plus `addDays`. */
function localDayStart(day: string, addDays = 0): string {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d + addDays).toISOString();
}

export default function AdminActionsTab() {
    const { t } = useTranslation();
    const [days, setDays] = useState('30');
    const [range, setRange] = useState<[string | null, string | null]>([null, null]);
    const [actor, setActor] = useState<string | null>(null);
    const [action, setAction] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search.trim(), 400);
    const [data, setData] = useState<AdminEventsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
    const [downloading, setDownloading] = useState<'csv' | 'txt' | null>(null);
    const [page, setPage] = useState(1);
    const requestId = useRef(0);

    // A complete date range replaces the period
    const [rangeStart, rangeEnd] = range;
    const params = useCallback(() => {
        const p: Record<string, string> = {
            category: 'admin',
            search: debouncedSearch,
            actor: actor ?? '',
            action: action ?? '',
            success: outcome ?? '',
        };
        if (rangeStart && rangeEnd) {
            p.days = '3650';
            p.start = localDayStart(rangeStart);
            p.end = localDayStart(rangeEnd, 1);
        } else {
            p.days = days;
        }
        return p;
    }, [days, rangeStart, rangeEnd, actor, action, outcome, debouncedSearch]);

    const load = useCallback(() => {
        const id = ++requestId.current;
        setLoading(true);
        axios.get<AdminEventsResponse>(apiRoutes.auditEvents, { params: { ...params(), limit: LIMIT } })
            .then((r) => {
                if (id !== requestId.current) { return; }
                setData(r.data);
                setError(null);
                setPage(1);
            }).catch(async (err) => {
                if (id !== requestId.current) { return; }
                setError({
                    message: (await extractError(err)) ?? t('Could not load admin actions'),
                    notFound: err?.response?.status === 404,
                });
            }).finally(() => {
                if (id === requestId.current) { setLoading(false); }
            });
    }, [params, t]);

    useEffect(() => { load(); }, [load]);

    async function download(format: 'csv' | 'txt') {
        setDownloading(format);
        try {
            await downloadFile(apiRoutes.auditEventsDownload, { ...params(), format }, `admin-actions.${format}`);
        } catch (err) {
            notifications.show({
                title: t('Download failed'),
                message: (await extractError(err)) ?? t('The admin action log could not be downloaded'),
                color: 'red',
                icon: <IconX />,
            });
        } finally {
            setDownloading(null);
        }
    }

    const events = data?.events ?? [];
    const pagedEvents = events.slice((page - 1) * EVENTS_PER_PAGE, page * EVENTS_PER_PAGE);
    const actionLabels = new Map((data?.actions ?? []).map((a) => [a.action, a.label || humanize(a.action)]));
    const filtered = !!(actor || action || outcome || debouncedSearch || (rangeStart && rangeEnd));

    const periodOptions = [
        { value: '1', label: t('Last 24 hours') },
        { value: '7', label: t('Last 7 days') },
        { value: '30', label: t('Last 30 days') },
        { value: '90', label: t('Last 90 days') },
        { value: '365', label: t('Last year') },
    ];

    function clearFilters() {
        setRange([null, null]);
        setActor(null);
        setAction(null);
        setOutcome(null);
        setSearch('');
    }

    if (error?.notFound) {
        return (
            <Section>
                <EmptyState
                    icon={<IconShieldX size={26} />}
                    color="orange"
                    title={t('Admin action log is not available on this server')}
                    description={t('Update the C4 RAVEN server to a version that includes the admin action log')}
                    action={<Button variant="light" mt="sm" leftSection={<IconRefresh size={16} />} onClick={load}>{t('Try again')}</Button>}
                />
            </Section>
        );
    }

    return (
        <Stack gap="lg">
            <Paper p="md" className="raven-surface">
                <Group justify="space-between" gap="sm" wrap="wrap">
                    <Group gap="sm" wrap="wrap">
                        <Select
                            aria-label={t('Period')}
                            data={periodOptions}
                            value={days}
                            onChange={(v) => v && setDays(v)}
                            allowDeselect={false}
                            disabled={!!(rangeStart && rangeEnd)}
                            w={170}
                        />
                        <DatePickerInput
                            type="range"
                            aria-label={t('Date range')}
                            placeholder={t('Pick dates')}
                            leftSection={<IconCalendar size={16} />}
                            value={range}
                            onChange={(v) => setRange(v as [string | null, string | null])}
                            clearable
                            maxDate={new Date()}
                            w={250}
                        />
                    </Group>
                    <Group gap="xs">
                        <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={load} loading={loading}>
                            {t('Refresh')}
                        </Button>
                        <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => download('txt')} loading={downloading === 'txt'}>
                            {t('Download .txt')}
                        </Button>
                        <Button leftSection={<IconDownload size={16} />} onClick={() => download('csv')} loading={downloading === 'csv'}>
                            {t('Download .csv')}
                        </Button>
                    </Group>
                </Group>
            </Paper>

            {error && (
                <Alert color="red" variant="light" icon={<IconAlertCircle />} title={t('Could not load admin actions')}>
                    {error.message}
                </Alert>
            )}

            <Section
                title={t('Admin actions')}
                description={t('Every change made through the web interface or API: who did it, from where, and whether it worked. Passwords, tokens and keys are never recorded.')}
            >
                <Group gap="sm" mb="md" wrap="wrap">
                    <Select
                        aria-label={t('Actor')}
                        placeholder={t('Anyone')}
                        searchable
                        clearable
                        data={data?.actors ?? []}
                        value={actor}
                        onChange={setActor}
                        w={180}
                    />
                    <Select
                        aria-label={t('Action')}
                        placeholder={t('All actions')}
                        searchable
                        clearable
                        data={(data?.actions ?? []).map((a) => ({ value: a.action, label: a.label || humanize(a.action) }))}
                        value={action}
                        onChange={setAction}
                        w={240}
                    />
                    <Select
                        aria-label={t('Outcome')}
                        placeholder={t('Any outcome')}
                        clearable
                        data={[
                            { value: 'true', label: t('Succeeded') },
                            { value: 'false', label: t('Failed') },
                        ]}
                        value={outcome}
                        onChange={setOutcome}
                        w={150}
                    />
                    <TextInput
                        aria-label={t('Search')}
                        placeholder={t('Search target, path, IP or details')}
                        leftSection={<IconSearch size={16} />}
                        value={search}
                        onChange={(e) => setSearch(e.currentTarget.value)}
                        style={{ flex: '1 1 220px' }}
                        maw={360}
                    />
                    {filtered && (
                        <Button variant="subtle" size="xs" onClick={clearFilters}>{t('Clear filters')}</Button>
                    )}
                    <Text size="xs" c="dimmed">
                        {data && data.total > events.length
                            ? t('Showing newest {{shown}} of {{count}} actions', { shown: events.length, count: data.total })
                            : t('{{count}} actions', { count: events.length })}
                    </Text>
                </Group>
                <Table.ScrollContainer minWidth={900}>
                    <DataTable
                        withTableBorder
                        borderRadius="md"
                        highlightOnHover
                        verticalAlign="top"
                        records={pagedEvents}
                        idAccessor="id"
                        fetching={loading && !!data}
                        minHeight={events.length === 0 ? 180 : undefined}
                        noRecordsText={t('No admin actions match these filters')}
                        rowBackgroundColor={(e) => (e.success === false
                            ? { light: 'rgba(250, 82, 82, 0.08)', dark: 'rgba(250, 82, 82, 0.12)' }
                            : undefined)}
                        totalRecords={events.length}
                        recordsPerPage={EVENTS_PER_PAGE}
                        page={page}
                        onPageChange={setPage}
                        columns={[
                            {
                                accessor: 'timestamp',
                                title: t('Time'),
                                width: 190,
                                render: (e) => (
                                    <Tooltip label={formatRelative(e.timestamp)}>
                                        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.timestamp, true)}</Text>
                                    </Tooltip>
                                ),
                            },
                            {
                                accessor: 'summary',
                                title: t('Action'),
                                render: (e) => (
                                    <Stack gap={2}>
                                        <Group gap={6} wrap="nowrap" align="flex-start">
                                            {e.success === false
                                                ? <IconCircleX size={14} color="var(--mantine-color-red-5)" style={{ flexShrink: 0, marginTop: 3 }} />
                                                : <IconCircleCheck size={14} color="var(--mantine-color-green-5)" style={{ flexShrink: 0, marginTop: 3 }} />}
                                            <Text size="sm" fw={500} c={e.success === false ? 'red.5' : undefined} style={{ overflowWrap: 'anywhere' }}>
                                                {e.summary || actionLabels.get(e.action) || humanize(e.action)}
                                            </Text>
                                        </Group>
                                        {e.success === false && <Badge size="xs" variant="light" color="red" w="fit-content">{t('Failed')}</Badge>}
                                    </Stack>
                                ),
                            },
                            {
                                accessor: 'actor',
                                title: t('By'),
                                render: (e) => {
                                    // record_audit_event drops actor when the target is the actor's own account
                                    const by = e.actor || e.username;
                                    return (
                                        <Stack gap={0}>
                                            <Text size="sm">{by || '—'}</Text>
                                            {e.actor && e.username && (
                                                <Text size="xs" c="dimmed">{t('on {{user}}', { user: e.username })}</Text>
                                            )}
                                        </Stack>
                                    );
                                },
                            },
                            {
                                accessor: 'ip',
                                title: t('IP address'),
                                render: (e) => (
                                    <Tooltip label={e.user_agent ?? ''} disabled={!e.user_agent} multiline maw={360}>
                                        <Text size="sm" ff="monospace">{e.ip || '—'}</Text>
                                    </Tooltip>
                                ),
                            },
                            {
                                accessor: 'details',
                                title: t('Details'),
                                render: (e) => (e.details
                                    ? <Text size="xs" c="dimmed" lineClamp={2} title={e.details} ff="monospace" style={{ overflowWrap: 'anywhere' }}>{e.details}</Text>
                                    : <Text size="xs" c="dimmed">—</Text>),
                            },
                        ]}
                    />
                </Table.ScrollContainer>
            </Section>
        </Stack>
    );
}
