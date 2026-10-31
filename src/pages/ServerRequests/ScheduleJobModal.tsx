import React, { useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, NumberInput, Paper, Select, Stack, Text } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconCalendarEvent, IconCheck } from '@tabler/icons-react';
import { addMinutes, format, formatISO, isValid, parseISO, startOfMinute } from 'date-fns';
import { useTranslation } from 'react-i18next';
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import { extractError, parseDate } from './shared';

export type Repeat = 'once' | 'minutes' | 'hourly' | 'daily' | 'weekly';
const REPEATS: Repeat[] = ['once', 'minutes', 'hourly', 'daily', 'weekly'];

export interface SchedulableJob {
    id: string;
    next_run_time: string | null;
    repeat?: Repeat | 'custom';
    interval_minutes?: number | null;
}

// Mantine dates v9 hands back "YYYY-MM-DD HH:mm:ss" in local time.
const PICKER_FORMAT = 'yyyy-MM-dd HH:mm:ss';

function toPicker(d: Date): string {
    return format(d, PICKER_FORMAT);
}

function fromPicker(v: string | null): Date | null {
    if (!v) {
        return null;
    }
    const d = parseISO(v.replace(' ', 'T'));
    return isValid(d) ? d : null;
}

function defaultStart(job: SchedulableJob): Date {
    const next = parseDate(job.next_run_time);
    if (next && next.getTime() > Date.now() + 60_000) {
        return startOfMinute(next);
    }
    return startOfMinute(addMinutes(new Date(), 5));
}

export function describeSchedule(
    t: (k: string, o?: Record<string, unknown>) => string,
    repeat: Repeat,
    start: Date | null,
    minutes: number | null
): string {
    if (!start) {
        return t('Pick a date and time');
    }
    const day = format(start, 'EEE d MMM');
    const time = format(start, 'HH:mm');
    switch (repeat) {
        case 'once':
            return t('Runs once on {{day}} at {{time}}', { day: format(start, 'EEE d MMM yyyy'), time });
        case 'minutes':
            return minutes === 1
                ? t('Runs every minute, starting {{day}} at {{time}}', { day, time })
                : t('Runs every {{n}} minutes, starting {{day}} at {{time}}', { n: minutes ?? '?', day, time });
        case 'hourly':
            return t('Runs every hour at {{minute}} past, starting {{day}} at {{time}}', {
                minute: format(start, 'mm'),
                day,
                time,
            });
        case 'daily':
            return t('Runs every day at {{time}}, starting {{day}}', { time, day });
        case 'weekly':
            return t('Runs every {{weekday}} at {{time}}, starting {{day}}', {
                weekday: format(start, 'EEEE'),
                time,
                day,
            });
    }
    return '';
}

export default function ScheduleJobModal({
    job,
    jobName,
    onClose,
    onSaved,
}: {
    job: SchedulableJob | null;
    jobName: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t } = useTranslation();
    const [runAt, setRunAt] = useState<string | null>(null);
    const [repeat, setRepeat] = useState<Repeat>('daily');
    const [minutes, setMinutes] = useState<number | string>(60);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Prefill whenever a (different) job is opened.
    useEffect(() => {
        if (!job) {
            return;
        }
        setRunAt(toPicker(defaultStart(job)));
        setRepeat(job.repeat && (REPEATS as string[]).includes(job.repeat) ? (job.repeat as Repeat) : 'daily');
        setMinutes(job.interval_minutes && job.interval_minutes > 0 ? job.interval_minutes : 60);
        setError(null);
    }, [job]);

    const start = fromPicker(runAt);
    const minutesNum = typeof minutes === 'number' ? minutes : null;
    const minutesValid = repeat !== 'minutes' || (minutesNum !== null && minutesNum >= 1 && minutesNum <= 10080);
    const inPast = start !== null && start.getTime() <= Date.now();
    const canSave = !!job && !!start && !inPast && minutesValid && !saving;

    function save() {
        if (!job || !start || !canSave) {
            return;
        }
        setSaving(true);
        setError(null);
        const body: Record<string, unknown> = {
            job_id: job.id,
            run_at: formatISO(start),
            repeat,
            resume: true,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        if (repeat === 'minutes') {
            body.interval_minutes = minutesNum;
        }
        axios
            .post(apiRoutes.scheduleJob, body)
            .then(() => {
                notifications.show({
                    title: t('Schedule saved'),
                    message: `${jobName}: ${describeSchedule(t, repeat, start, minutesNum)}`,
                    color: 'green',
                    icon: <IconCheck />,
                });
                onSaved();
                onClose();
            })
            .catch(async (err) => {
                setError((await extractError(err)) ?? t('The schedule could not be saved'));
            })
            .finally(() => setSaving(false));
    }

    const repeatOptions = [
        { value: 'once', label: t('Run once') },
        { value: 'minutes', label: t('Every N minutes') },
        { value: 'hourly', label: t('Hourly') },
        { value: 'daily', label: t('Daily') },
        { value: 'weekly', label: t('Weekly') },
    ];

    return (
        <Modal
            opened={job !== null}
            onClose={onClose}
            title={t('Schedule {{name}}', { name: jobName })}
            size="md"
        >
            <Stack gap="md">
                {job?.repeat === 'custom' && (
                    <Text size="xs" c="dimmed">
                        {t('This job currently uses a custom schedule — saving replaces it')}
                    </Text>
                )}
                <DateTimePicker
                    label={t('Starts')}
                    description={t('Your local time')}
                    leftSection={<IconCalendarEvent size={16} />}
                    value={runAt}
                    onChange={setRunAt}
                    minDate={new Date()}
                    valueFormat="ddd D MMM YYYY, HH:mm"
                    popoverProps={{ withinPortal: true }}
                    error={inPast ? t('Pick a time in the future') : undefined}
                />
                <Select
                    label={t('Repeat')}
                    data={repeatOptions}
                    value={repeat}
                    onChange={(v) => v && setRepeat(v as Repeat)}
                    allowDeselect={false}
                />
                {repeat === 'minutes' && (
                    <NumberInput
                        label={t('Every how many minutes')}
                        min={1}
                        max={10080}
                        allowDecimal={false}
                        allowNegative={false}
                        clampBehavior="strict"
                        value={minutes}
                        onChange={setMinutes}
                        suffix={` ${t('min')}`}
                        error={!minutesValid ? t('Enter 1 to 10080 minutes') : undefined}
                    />
                )}
                <Paper p="sm" className="raven-surface raven-surface--tile">
                    <Text size="sm">{describeSchedule(t, repeat, start, minutesNum)}</Text>
                </Paper>
                {error && (
                    <Alert color="red" variant="light" icon={<IconAlertCircle />}>
                        {error}
                    </Alert>
                )}
                <Group justify="flex-end">
                    <Button variant="default" onClick={onClose}>
                        {t('Cancel')}
                    </Button>
                    <Button onClick={save} loading={saving} disabled={!canSave}>
                        {t('Save')}
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}
