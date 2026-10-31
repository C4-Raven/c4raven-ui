import React, { useCallback, useEffect, useState } from 'react';
import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Group,
    Loader,
    Paper,
    Pill,
    Skeleton,
    Stack,
    Switch,
    Text,
    Tooltip,
} from '@mantine/core';
import { useInterval } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconCalendarOff,
    IconCalendarTime,
    IconCheck,
    IconClock,
    IconPlayerPause,
    IconPlayerPlay,
    IconRefresh,
    IconX,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import ScheduleJobModal, { type Repeat } from './ScheduleJobModal';
import { EmptyState, extractError, formatDateTime, formatRelative, humanize, Section } from './shared';

export interface ScheduledJob {
    id: string;
    name?: string;
    next_run_time: string | null;
    trigger?: string;
    description?: string;
    schedule?: string;
    repeat?: Repeat | 'custom';
    interval_minutes?: number | null;
    scheduled_runs?: { id: string; run_at: string }[];
}

// Being removed server-side; hide them in case an older server still reports them.
const HIDDEN_JOB_IDS = new Set(['get_adsb_data', 'ais']);

function jobLabel(job: ScheduledJob): string {
    // Prefer the id when the name is just a function path like "module.func".
    const source = job.name && !job.name.includes('.') ? job.name : job.id;
    return humanize(source);
}

export default function ScheduledJobsTab() {
    const { t } = useTranslation();
    const [jobs, setJobs] = useState<ScheduledJob[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState<string | null>(null);
    const [toggling, setToggling] = useState<string | null>(null);
    const [scheduling, setScheduling] = useState<ScheduledJob | null>(null);
    const [cancelling, setCancelling] = useState<string | null>(null);
    // Re-render periodically so the "in 3 min" text stays current.
    const [, setTick] = useState(0);
    const ticker = useInterval(() => setTick((n) => n + 1), 30_000);

    const getJobs = useCallback((quiet = false) => {
        if (!quiet) { setLoading(true); }
        return axios.get(apiRoutes.getScheduledJobs).then((r) => {
            const list: ScheduledJob[] = Array.isArray(r.data) ? r.data : (r.data?.results ?? []);
            // One-off runs are listed under their job (scheduled_runs); hide any
            // that an older server still reports as their own rows.
            setJobs(list.filter((j) => !HIDDEN_JOB_IDS.has(j.id) && !j.id.includes('__once__')));
            setError(null);
        }).catch(async (err) => {
            setError((await extractError(err)) ?? t('Could not load scheduled jobs'));
        }).finally(() => setLoading(false));
    }, [t]);

    useEffect(() => {
        getJobs();
        ticker.start();
        return ticker.stop;
    }, []);

    function runJob(job: ScheduledJob) {
        setRunning(job.id);
        axios.post(apiRoutes.runJob, { job_id: job.id }).then(() => {
            notifications.show({
                title: t('Job started'),
                message: t('{{name}} is running now', { name: jobLabel(job) }),
                color: 'green',
                icon: <IconCheck />,
            });
            getJobs(true);
        }).catch(async (err) => {
            notifications.show({
                title: t('Could not run job'),
                message: (await extractError(err)) ?? jobLabel(job),
                color: 'red',
                icon: <IconX />,
            });
        }).finally(() => setRunning(null));
    }

    function toggleJob(job: ScheduledJob, active: boolean) {
        setToggling(job.id);
        axios.post(active ? apiRoutes.resumeJob : apiRoutes.pauseJob, { job_id: job.id }).then(() => {
            notifications.show({
                title: active ? t('Job resumed') : t('Job paused'),
                message: active
                    ? t('{{name}} will run on its schedule again', { name: jobLabel(job) })
                    : t('{{name}} will not run until it is resumed', { name: jobLabel(job) }),
                color: active ? 'green' : 'gray',
                icon: active ? <IconPlayerPlay /> : <IconPlayerPause />,
            });
            return getJobs(true);
        }).catch(async (err) => {
            notifications.show({
                title: t('Could not update job'),
                message: (await extractError(err)) ?? jobLabel(job),
                color: 'red',
                icon: <IconX />,
            });
        }).finally(() => setToggling(null));
    }

    function cancelRun(job: ScheduledJob, run: { id: string; run_at: string }) {
        setCancelling(run.id);
        axios.post(apiRoutes.cancelScheduledRun, { job_id: run.id }).then(() => {
            notifications.show({
                title: t('Scheduled run cancelled'),
                message: t('{{name}} will no longer run on {{when}}', { name: jobLabel(job), when: formatDateTime(run.run_at) }),
                color: 'gray',
                icon: <IconCheck />,
            });
            return getJobs(true);
        }).catch(async (err) => {
            notifications.show({
                title: t('Could not cancel the scheduled run'),
                message: (await extractError(err)) ?? jobLabel(job),
                color: 'red',
                icon: <IconX />,
            });
        }).finally(() => setCancelling(null));
    }

    const sorted = [...jobs].sort((a, b) => jobLabel(a).localeCompare(jobLabel(b)));

    return (
        <Section
            title={t('Scheduled jobs')}
            description={t('Background tasks the server runs on a timer — set when each one runs, pause it, or run it once right now')}
            actions={
                <Tooltip label={t('Refresh')}>
                    <ActionIcon variant="light" size="lg" onClick={() => getJobs()} loading={loading} aria-label={t('Refresh')}>
                        <IconRefresh size={18} />
                    </ActionIcon>
                </Tooltip>
            }
        >
            {error && (
                <Alert color="red" variant="light" icon={<IconAlertCircle />} mb="md" title={t('Could not load scheduled jobs')}>
                    {error}
                </Alert>
            )}

            {loading && jobs.length === 0 ? (
                <Stack gap="sm">
                    {[0, 1, 2].map((i) => <Skeleton key={i} h={84} radius="md" />)}
                </Stack>
            ) : sorted.length === 0 && !error ? (
                <EmptyState
                    icon={<IconCalendarOff size={26} />}
                    title={t('No scheduled jobs')}
                    description={t('The server is not reporting any background jobs')}
                />
            ) : (
                <Stack gap="sm">
                    {sorted.map((job) => {
                        const paused = job.next_run_time === null;
                        const busy = toggling === job.id;
                        return (
                            <Paper key={job.id} p="md" className="raven-surface raven-surface--tile">
                                <Group justify="space-between" align="center" gap="md" wrap="wrap">
                                    <Stack gap={4} style={{ flex: '1 1 280px', minWidth: 0 }}>
                                        <Group gap="xs" wrap="wrap">
                                            <Text fw={600}>{jobLabel(job)}</Text>
                                            {job.schedule && (
                                                <Badge variant="light" color="blue" size="sm" leftSection={<IconClock size={12} />} tt="none">
                                                    {job.schedule}
                                                </Badge>
                                            )}
                                        </Group>
                                        {job.description && <Text size="sm" c="dimmed">{job.description}</Text>}
                                        {(job.scheduled_runs?.length ?? 0) > 0 && (
                                            <Group gap={6} mt={4} wrap="wrap">
                                                {[...(job.scheduled_runs ?? [])]
                                                    .sort((a, b) => a.run_at.localeCompare(b.run_at))
                                                    .map((run) => (
                                                        <Pill
                                                            key={run.id}
                                                            withRemoveButton
                                                            disabled={cancelling === run.id}
                                                            onRemove={() => cancelRun(job, run)}
                                                            removeButtonProps={{ 'aria-label': t('Cancel this run') }}
                                                            title={formatRelative(run.run_at)}
                                                        >
                                                            {t('Once')}{' · '}{formatDateTime(run.run_at)}
                                                        </Pill>
                                                    ))}
                                            </Group>
                                        )}
                                    </Stack>

                                    <Group gap="md" wrap="wrap" style={{ flex: '0 1 auto' }}>
                                        <Stack gap={0} miw={170} align="flex-start">
                                            <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.4}>{t('Next run')}</Text>
                                            {paused ? (
                                                <Badge color="gray" variant="outline" mt={4} leftSection={<IconPlayerPause size={12} />}>{t('Paused')}</Badge>
                                            ) : (
                                                <>
                                                    <Text size="sm" fw={500}>{formatDateTime(job.next_run_time)}</Text>
                                                    <Text size="xs" c="dimmed">{formatRelative(job.next_run_time)}</Text>
                                                </>
                                            )}
                                        </Stack>
                                        <Button
                                            variant="light"
                                            size="xs"
                                            leftSection={<IconPlayerPlay size={14} />}
                                            loading={running === job.id}
                                            onClick={() => runJob(job)}
                                        >
                                            {t('Run now')}
                                        </Button>
                                        <Tooltip label={t('Set when this job runs')}>
                                            <ActionIcon
                                                variant="light"
                                                size="lg"
                                                aria-label={t('Schedule')}
                                                onClick={() => setScheduling(job)}
                                            >
                                                <IconCalendarTime size={18} />
                                            </ActionIcon>
                                        </Tooltip>
                                        <Tooltip label={paused ? t('Resume job') : t('Pause job')}>
                                            <div>
                                                <Switch
                                                    aria-label={t('Active')}
                                                    checked={!paused}
                                                    disabled={busy}
                                                    thumbIcon={busy ? <Loader size={8} /> : undefined}
                                                    onChange={(e) => toggleJob(job, e.currentTarget.checked)}
                                                />
                                            </div>
                                        </Tooltip>
                                    </Group>
                                </Group>
                            </Paper>
                        );
                    })}
                </Stack>
            )}
            <ScheduleJobModal
                job={scheduling}
                jobName={scheduling ? jobLabel(scheduling) : ''}
                onClose={() => setScheduling(null)}
                onSaved={() => getJobs(true)}
            />
        </Section>
    );
}
