import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Group,
    NumberInput,
    Paper,
    SegmentedControl,
    Select,
    Skeleton,
    Stack,
    Text,
    Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconCheck,
    IconClock,
    IconDatabase,
    IconDeviceFloppy,
    IconFiles,
    IconInfinity,
    IconPlayerPlay,
    IconRefresh,
    IconX,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import bytes_formatter from '../../bytes_formatter';
import { EmptyState, extractError, formatDateTime, formatRelative, Section } from './shared';

interface RetentionType {
    key: string;
    label: string;
    description: string;
    keep_seconds: number | null;
    default_seconds: number | null;
    customized: boolean;
    has_files: boolean;
    count: number | null;
    count_approximate: boolean;
    size_bytes: number | null;
    updated_at: string | null;
    updated_by: string | null;
    last_purge_at: string | null;
    last_purge_count: number | null;
    last_purge_error: string | null;
}

interface RetentionResponse {
    types: RetentionType[];
    job: { id: string; exists: boolean; next_run_time: string | null };
}

type Unit = 'hours' | 'days';
interface Draft { forever: boolean; amount: number; unit: Unit }

const HOUR = 3600;
const DAY = 86400;
const JOB_ID = 'apply_data_retention';

function toDraft(seconds: number | null): Draft {
    if (seconds === null) { return { forever: true, amount: 30, unit: 'days' }; }
    if (seconds % DAY === 0) { return { forever: false, amount: seconds / DAY, unit: 'days' }; }
    return { forever: false, amount: Math.max(1, Math.round(seconds / HOUR)), unit: 'hours' };
}

function toSeconds(draft: Draft): number | null {
    if (draft.forever) { return null; }
    return Math.round(draft.amount) * (draft.unit === 'days' ? DAY : HOUR);
}

function draftValid(draft: Draft): boolean {
    if (draft.forever) { return true; }
    const seconds = toSeconds(draft) ?? 0;
    return Number.isFinite(draft.amount) && draft.amount >= 1 && seconds >= HOUR && seconds <= 3650 * DAY;
}

export default function DataRetentionTab() {
    const { t } = useTranslation();
    const [data, setData] = useState<RetentionResponse | null>(null);
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [purging, setPurging] = useState(false);

    const load = useCallback((quiet = false) => {
        if (!quiet) { setLoading(true); }
        return axios.get<RetentionResponse>(apiRoutes.retention).then((r) => {
            setData(r.data);
            setDrafts(Object.fromEntries(r.data.types.map((type) => [type.key, toDraft(type.keep_seconds)])));
            setError(null);
        }).catch(async (err) => {
            setError((await extractError(err)) ?? t('Could not load retention settings'));
        }).finally(() => setLoading(false));
    }, [t]);

    useEffect(() => { load(); }, []);

    const changed = useMemo(() => {
        const out: Record<string, number | null> = {};
        for (const type of data?.types ?? []) {
            const draft = drafts[type.key];
            if (draft && draftValid(draft) && toSeconds(draft) !== type.keep_seconds) {
                out[type.key] = toSeconds(draft);
            }
        }
        return out;
    }, [data, drafts]);
    const invalid = Object.values(drafts).some((d) => !draftValid(d));
    const dirty = Object.keys(changed).length > 0;

    function setDraft(key: string, patch: Partial<Draft>) {
        setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    }

    function save() {
        setSaving(true);
        axios.put<RetentionResponse>(apiRoutes.retention, { settings: changed }).then((r) => {
            setData(r.data);
            setDrafts(Object.fromEntries(r.data.types.map((type) => [type.key, toDraft(type.keep_seconds)])));
            notifications.show({
                title: t('Retention saved'),
                message: t('Older data is removed on the next purge run'),
                color: 'green',
                icon: <IconCheck />,
            });
        }).catch(async (err) => {
            notifications.show({
                title: t('Could not save retention settings'),
                message: (await extractError(err)) ?? '',
                color: 'red',
                icon: <IconX />,
            });
        }).finally(() => setSaving(false));
    }

    function purgeNow() {
        setPurging(true);
        axios.post(apiRoutes.runJob, { job_id: JOB_ID }).then(() => {
            notifications.show({
                title: t('Purge started'),
                message: t('Data older than its retention is being deleted in the background'),
                color: 'green',
                icon: <IconPlayerPlay />,
            });
            // The job runs in the background; refresh once it has had time to finish.
            setTimeout(() => load(true), 4000);
        }).catch(async (err) => {
            notifications.show({
                title: t('Could not start the purge'),
                message: (await extractError(err)) ?? '',
                color: 'red',
                icon: <IconX />,
            });
        }).finally(() => setPurging(false));
    }

    const job = data?.job;

    return (
        <Section
            title={t('Data retention')}
            description={t('How long the server keeps each kind of data. Older data is deleted automatically in small batches; anything set to forever is never deleted by this.')}
            actions={
                <Group gap="xs">
                    <Tooltip label={t('Delete data older than its retention right now')}>
                        <Button
                            variant="light"
                            size="xs"
                            leftSection={<IconPlayerPlay size={14} />}
                            loading={purging}
                            disabled={dirty}
                            onClick={purgeNow}
                        >
                            {t('Purge now')}
                        </Button>
                    </Tooltip>
                    <Button
                        size="xs"
                        leftSection={<IconDeviceFloppy size={14} />}
                        loading={saving}
                        disabled={!dirty || invalid}
                        onClick={save}
                    >
                        {t('Save changes')}
                    </Button>
                    <Tooltip label={t('Refresh')}>
                        <ActionIcon variant="light" size="lg" onClick={() => load()} loading={loading} aria-label={t('Refresh')}>
                            <IconRefresh size={18} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            }
        >
            {error && (
                <Alert color="red" variant="light" icon={<IconAlertCircle />} mb="md" title={t('Could not load retention settings')}>
                    {error}
                </Alert>
            )}

            {job && (
                <Text size="sm" c="dimmed" mb="md">
                    {!job.exists
                        ? t('The purge job is not scheduled. Restart the server to add it.')
                        : job.next_run_time
                            ? t('Next purge {{when}}', { when: formatRelative(job.next_run_time) })
                            : t('The purge job is paused on the Scheduled Jobs tab, so nothing is deleted automatically.')}
                </Text>
            )}

            {loading && !data ? (
                <Stack gap="sm">
                    {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={84} radius="md" />)}
                </Stack>
            ) : !data?.types.length && !error ? (
                <EmptyState icon={<IconDatabase size={26} />} title={t('No data types')} description={t('The server did not report any retention settings')} />
            ) : (
                <Stack gap="sm">
                    {(data?.types ?? []).map((type) => {
                        const draft = drafts[type.key] ?? toDraft(type.keep_seconds);
                        const isChanged = type.key in changed;
                        const valid = draftValid(draft);
                        return (
                            <Paper key={type.key} p="md" className="raven-surface raven-surface--tile">
                                <Group justify="space-between" align="center" gap="md" wrap="wrap">
                                    <Stack gap={4} style={{ flex: '1 1 300px', minWidth: 0 }}>
                                        <Group gap="xs" wrap="wrap">
                                            <Text fw={600}>{t(type.label)}</Text>
                                            {type.count !== null && (
                                                <Badge variant="light" color="gray" size="sm" tt="none" leftSection={type.has_files ? <IconFiles size={12} /> : <IconDatabase size={12} />}>
                                                    {type.count_approximate ? '~' : ''}{type.count.toLocaleString()}
                                                    {' '}{type.has_files && type.key === 'error_logs' ? t('files') : t('items')}
                                                </Badge>
                                            )}
                                            {type.size_bytes !== null && (
                                                <Badge variant="light" color="gray" size="sm" tt="none">{bytes_formatter(type.size_bytes, 1)}</Badge>
                                            )}
                                            {isChanged && <Badge variant="light" color="yellow" size="sm">{t('Unsaved')}</Badge>}
                                        </Group>
                                        <Text size="sm" c="dimmed">{t(type.description)}</Text>
                                        <Text size="xs" c={type.last_purge_error ? 'red' : 'dimmed'}>
                                            {type.last_purge_error
                                                ? t('Last purge {{when}} failed: {{error}}', { when: formatRelative(type.last_purge_at), error: type.last_purge_error })
                                                : type.last_purge_at
                                                    ? t('Last purge {{when}} · {{count}} deleted', { when: formatRelative(type.last_purge_at), count: type.last_purge_count ?? 0 })
                                                    : t('Never purged')}
                                            {type.customized && type.updated_by && (
                                                <span title={formatDateTime(type.updated_at)}>
                                                    {' · '}{t('Set by {{user}}', { user: type.updated_by })}
                                                </span>
                                            )}
                                        </Text>
                                    </Stack>

                                    <Group gap="xs" wrap="wrap" style={{ flex: '0 1 auto' }}>
                                        <SegmentedControl
                                            size="xs"
                                            value={draft.forever ? 'forever' : 'limit'}
                                            onChange={(v) => setDraft(type.key, { forever: v === 'forever' })}
                                            data={[
                                                { value: 'forever', label: <Group gap={4} wrap="nowrap"><IconInfinity size={14} />{t('Forever')}</Group> },
                                                { value: 'limit', label: <Group gap={4} wrap="nowrap"><IconClock size={14} />{t('Keep for')}</Group> },
                                            ]}
                                        />
                                        <NumberInput
                                            size="xs"
                                            w={84}
                                            min={1}
                                            max={draft.unit === 'days' ? 3650 : 87600}
                                            allowDecimal={false}
                                            disabled={draft.forever}
                                            value={draft.amount}
                                            error={!valid}
                                            aria-label={t('Amount')}
                                            onChange={(v) => setDraft(type.key, { amount: typeof v === 'number' ? v : parseInt(v, 10) })}
                                        />
                                        <Select
                                            size="xs"
                                            w={92}
                                            disabled={draft.forever}
                                            allowDeselect={false}
                                            value={draft.unit}
                                            aria-label={t('Unit')}
                                            onChange={(v) => v && setDraft(type.key, { unit: v as Unit })}
                                            data={[
                                                { value: 'hours', label: t('hours') },
                                                { value: 'days', label: t('days') },
                                            ]}
                                        />
                                    </Group>
                                </Group>
                            </Paper>
                        );
                    })}
                </Stack>
            )}
        </Section>
    );
}
