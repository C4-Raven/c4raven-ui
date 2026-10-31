import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Alert,
    Badge,
    Box,
    Button,
    Code,
    Collapse,
    Group,
    Paper,
    SegmentedControl,
    Select,
    Skeleton,
    Stack,
    Switch,
    Text,
    TextInput,
    Tooltip,
    UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue, useDocumentVisibility } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconChevronDown,
    IconChevronRight,
    IconDownload,
    IconHeartbeat,
    IconPlugConnectedX,
    IconRefresh,
    IconSearch,
    IconX,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import { downloadFile, EmptyState, extractError, formatDateTime, formatRelative, PulseDot, Section } from './shared';

interface LogEntry {
    id: string | number;
    timestamp: string;
    level: string;
    source: string | null;
    pid: number | null;
    module: string | null;
    function: string | null;
    line: number | null;
    message: string;
    traceback: string | null;
}

interface LogResponse {
    entries: LogEntry[];
    cursor: string | number | null;
    sources: string[];
}

const POLL_MS = 5000;
const MAX_ENTRIES = 2000;
const PAGE = 100;

function levelColor(level: string): string {
    const l = level.toUpperCase();
    if (l === 'CRITICAL') { return 'grape'; }
    if (l === 'ERROR') { return 'red'; }
    if (l === 'WARNING' || l === 'WARN') { return 'orange'; }
    return 'gray';
}

function location(e: LogEntry): string {
    return [e.module, e.function, e.line].filter((p) => p !== null && p !== undefined && p !== '').join(':');
}

function mergeEntries(incoming: LogEntry[], existing: LogEntry[]): LogEntry[] {
    if (incoming.length === 0) { return existing; }
    const seen = new Set(existing.map((e) => e.id));
    const fresh = incoming.filter((e) => !seen.has(e.id));
    if (fresh.length === 0) { return existing; }
    return [...fresh, ...existing].slice(0, MAX_ENTRIES);
}

export default function ErrorLogTab({ active }: { active: boolean }) {
    const { t } = useTranslation();
    const [level, setLevel] = useState('ERROR');
    const [source, setSource] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search.trim(), 400);
    const [live, setLive] = useState(true);
    const [entries, setEntries] = useState<LogEntry[]>([]);
    const [sources, setSources] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
    const [expanded, setExpanded] = useState<Set<LogEntry['id']>>(new Set());
    const [visibleCount, setVisibleCount] = useState(PAGE);
    const [downloading, setDownloading] = useState(false);
    const [lastPolled, setLastPolled] = useState<Date | null>(null);
    const visibility = useDocumentVisibility();

    const cursor = useRef<LogResponse['cursor']>(null);
    // Bumped on every reset so responses for old filters are dropped.
    const generation = useRef(0);
    const polling = useRef(false);

    const filterParams = useCallback(() => ({
        level,
        source: source ?? '',
        search: debouncedSearch,
        limit: 500,
    }), [level, source, debouncedSearch]);

    const reload = useCallback(() => {
        const gen = ++generation.current;
        setLoading(true);
        cursor.current = null;
        axios.get<LogResponse>(apiRoutes.errorLog, { params: filterParams() }).then((r) => {
            if (gen !== generation.current) { return; }
            setEntries((r.data.entries ?? []).slice(0, MAX_ENTRIES));
            cursor.current = r.data.cursor ?? null;
            if (r.data.sources) { setSources(r.data.sources); }
            setExpanded(new Set());
            setVisibleCount(PAGE);
            setError(null);
            setLastPolled(new Date());
        }).catch(async (err) => {
            if (gen !== generation.current) { return; }
            setEntries([]);
            setError({
                message: (await extractError(err)) ?? t('Could not load the error log'),
                notFound: err?.response?.status === 404,
            });
        }).finally(() => {
            if (gen === generation.current) { setLoading(false); }
        });
    }, [filterParams, t]);

    useEffect(() => { reload(); }, [reload]);

    const poll = useCallback(() => {
        if (polling.current) { return; }
        const gen = generation.current;
        polling.current = true;
        // No cursor yet (e.g. empty log): fetch the latest page; merge dedupes by id.
        const params = cursor.current === null ? filterParams() : { ...filterParams(), since: cursor.current };
        axios.get<LogResponse>(apiRoutes.errorLog, { params }).then((r) => {
            if (gen !== generation.current) { return; }
            setEntries((prev) => mergeEntries(r.data.entries ?? [], prev));
            if (r.data.cursor !== null && r.data.cursor !== undefined) { cursor.current = r.data.cursor; }
            if (r.data.sources) { setSources(r.data.sources); }
            setLastPolled(new Date());
        }).catch(() => {
            // Transient poll failures are ignored; the next tick retries.
        }).finally(() => {
            polling.current = false;
        });
    }, [filterParams]);

    const shouldPoll = live && active && visibility === 'visible' && !error && !loading;

    useEffect(() => {
        if (!shouldPoll) { return undefined; }
        const id = window.setInterval(poll, POLL_MS);
        return () => window.clearInterval(id);
    }, [shouldPoll, poll]);

    // Catch up straight away when coming back to the tab/window.
    useEffect(() => {
        if (shouldPoll) { poll(); }
    }, [shouldPoll]);

    async function download() {
        setDownloading(true);
        try {
            await downloadFile(apiRoutes.errorLogDownload, { level, source: source ?? '', days: 7 }, 'error-log.txt');
        } catch (err) {
            notifications.show({
                title: t('Download failed'),
                message: (await extractError(err)) ?? t('The error log could not be downloaded'),
                color: 'red',
                icon: <IconX />,
            });
        } finally {
            setDownloading(false);
        }
    }

    function toggle(id: LogEntry['id']) {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) { next.delete(id); } else { next.add(id); }
            return next;
        });
    }

    if (error?.notFound) {
        return (
            <Section>
                <EmptyState
                    icon={<IconPlugConnectedX size={26} />}
                    color="orange"
                    title={t('Error log is not available on this server')}
                    description={t('Update the C4 RAVEN server to a version that includes the error log')}
                    action={<Button variant="light" mt="sm" leftSection={<IconRefresh size={16} />} onClick={reload}>{t('Try again')}</Button>}
                />
            </Section>
        );
    }

    const filtersActive = level !== 'ERROR' || !!source || !!debouncedSearch;
    const liveRunning = live && active && visibility === 'visible' && !error;

    return (
        <Stack gap="lg">
            <Paper p="md" className="raven-surface">
                <Stack gap="sm">
                    <Group justify="space-between" gap="sm" wrap="wrap">
                        <Group gap="sm" wrap="wrap">
                            <SegmentedControl
                                value={level}
                                onChange={setLevel}
                                data={[
                                    { value: 'ERROR', label: t('Errors') },
                                    { value: 'WARNING', label: t('Warnings+') },
                                ]}
                            />
                            <Select
                                aria-label={t('Source')}
                                placeholder={t('All sources')}
                                clearable
                                searchable
                                data={sources}
                                value={source}
                                onChange={setSource}
                                w={190}
                            />
                            <TextInput
                                aria-label={t('Search')}
                                placeholder={t('Search messages')}
                                leftSection={<IconSearch size={16} />}
                                value={search}
                                onChange={(e) => setSearch(e.currentTarget.value)}
                                w={240}
                            />
                        </Group>
                        <Group gap="sm" wrap="wrap">
                            <Tooltip
                                label={liveRunning
                                    ? t('Checking for new entries every 5 seconds')
                                    : live ? t('Paused while this tab is hidden') : t('Live updates are off')}
                            >
                                <Group gap={8} wrap="nowrap">
                                    <PulseDot active={liveRunning} />
                                    <Switch
                                        label={t('Live')}
                                        checked={live}
                                        onChange={(e) => setLive(e.currentTarget.checked)}
                                    />
                                </Group>
                            </Tooltip>
                            <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={reload} loading={loading}>
                                {t('Refresh')}
                            </Button>
                            <Button leftSection={<IconDownload size={16} />} onClick={download} loading={downloading}>
                                {t('Download .txt')}
                            </Button>
                        </Group>
                    </Group>
                    <Text size="xs" c="dimmed">
                        {t('{{count}} entries', { count: entries.length })}
                        {lastPolled ? ` · ${t('Updated {{when}}', { when: formatDateTime(lastPolled, true) })}` : ''}
                    </Text>
                </Stack>
            </Paper>

            {error && (
                <Alert
                    color="red"
                    variant="light"
                    icon={<IconAlertCircle />}
                    title={t('Could not load the error log')}
                >
                    <Stack gap="xs" align="flex-start">
                        <Text size="sm">{error.message}</Text>
                        <Button size="xs" variant="light" color="red" onClick={reload}>{t('Try again')}</Button>
                    </Stack>
                </Alert>
            )}

            {loading && entries.length === 0 ? (
                <Stack gap="sm">
                    {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={76} radius="md" />)}
                </Stack>
            ) : entries.length === 0 && !error ? (
                <Section>
                    {filtersActive ? (
                        <EmptyState
                            icon={<IconSearch size={26} />}
                            title={t('Nothing matches these filters')}
                            description={t('Try a different level, source or search')}
                        />
                    ) : (
                        <EmptyState
                            icon={<IconHeartbeat size={26} />}
                            color="green"
                            title={t('No errors — the server is healthy')}
                            description={live ? t('New errors will appear here automatically') : undefined}
                        />
                    )}
                </Section>
            ) : (
                <Stack gap="xs">
                    {entries.slice(0, visibleCount).map((e) => {
                        const isOpen = expanded.has(e.id);
                        const loc = location(e);
                        return (
                            <Paper
                                key={e.id}
                                p="sm"
                                className="raven-surface raven-surface--tile"
                                pos="relative"
                                pl="md"
                            >
                                <Box
                                    aria-hidden
                                    pos="absolute"
                                    left={0}
                                    top={10}
                                    bottom={10}
                                    w={3}
                                    style={{ borderRadius: 3, background: `var(--mantine-color-${levelColor(e.level)}-6)` }}
                                />
                                <Group gap="xs" wrap="wrap" mb={4}>
                                    <Tooltip label={formatRelative(e.timestamp)}>
                                        <Text size="xs" c="dimmed" ff="monospace">{formatDateTime(e.timestamp, true)}</Text>
                                    </Tooltip>
                                    <Badge size="sm" variant="filled" color={levelColor(e.level)}>{e.level}</Badge>
                                    {e.source && <Badge size="sm" variant="light" color="gray" tt="none">{e.source}</Badge>}
                                    {loc && (
                                        <Text size="xs" c="dimmed" ff="monospace" style={{ overflowWrap: 'anywhere' }}>{loc}</Text>
                                    )}
                                    {e.pid !== null && e.pid !== undefined && (
                                        <Text size="xs" c="dimmed" ff="monospace">pid {e.pid}</Text>
                                    )}
                                </Group>
                                <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.message}</Text>
                                {e.traceback && (
                                    <>
                                        <UnstyledButton onClick={() => toggle(e.id)} mt={6} aria-expanded={isOpen}>
                                            <Group gap={4}>
                                                {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                                                <Text size="xs" fw={600} c="blue.4">
                                                    {isOpen ? t('Hide traceback') : t('Show traceback')}
                                                </Text>
                                            </Group>
                                        </UnstyledButton>
                                        <Collapse expanded={isOpen}>
                                            <Code block mt="xs" style={{ maxHeight: 360, overflow: 'auto', fontSize: 12 }}>
                                                {e.traceback}
                                            </Code>
                                        </Collapse>
                                    </>
                                )}
                            </Paper>
                        );
                    })}
                    {entries.length > visibleCount && (
                        <Button variant="subtle" onClick={() => setVisibleCount((n) => n + PAGE)} style={{ alignSelf: 'center' }}>
                            {t('Show {{count}} more', { count: Math.min(PAGE, entries.length - visibleCount) })}
                        </Button>
                    )}
                </Stack>
            )}
        </Stack>
    );
}
