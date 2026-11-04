import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Loader, Paper, Progress, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconCircleMinus, IconCircleX, IconRefresh, IconTool } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { extractError } from '../ServerRequests/shared';
import { checkPartner } from './api';
import { checksSummary, checkView, type CheckView } from './helpers';
import type { CheckItem } from './types';

const POLL_MS = 3000;

function LevelIcon({ level }: { level: CheckView['level'] }) {
    switch (level) {
        case 'ok': return <IconCircleCheck size={16} />;
        case 'warning': return <IconAlertTriangle size={16} />;
        case 'skipped': return <IconCircleMinus size={16} />;
        default: return <IconCircleX size={16} />;
    }
}
const POLL_FOR_MS = 120_000;

/**
 * Runs GET /partners/<id>/check and lists every check with a fix for the
 * failing ones. With `poll`, re-runs every 3 s for up to 2 minutes or until
 * everything passes (used right after connecting a new partner).
 */
export default function CheckPanel({ partnerId, poll = false, onResult }: {
    partnerId: string;
    poll?: boolean;
    onResult?: (checks: CheckItem[], finished: boolean) => void;
}) {
    const { t } = useTranslation();
    const [checks, setChecks] = useState<CheckItem[] | null>(null);
    const [error, setError] = useState<string>();
    const [running, setRunning] = useState(false);
    const [polling, setPolling] = useState(poll);
    const startedAt = useRef(Date.now());
    const onResultRef = useRef(onResult);
    onResultRef.current = onResult;

    const run = useCallback(async () => {
        setRunning(true);
        try {
            const result = await checkPartner(partnerId);
            setChecks(result);
            setError(undefined);
            return result;
        } catch (err) {
            setError(await extractError(err) ?? t('The check could not be run'));
            return null;
        } finally {
            setRunning(false);
        }
    }, [partnerId, t]);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        startedAt.current = Date.now();
        setPolling(poll);
        const tick = async () => {
            const result = await run();
            if (cancelled) { return; }
            // Stop once nothing is an error; a warning such as "no messages yet" can last for ages.
            const allOk = !!result && result.length > 0 && checksSummary(result).failed.length === 0;
            const timedOut = Date.now() - startedAt.current >= POLL_FOR_MS;
            const finished = !poll || allOk || timedOut;
            onResultRef.current?.(result ?? [], finished);
            if (finished) {
                setPolling(false);
            } else {
                timer = setTimeout(tick, POLL_MS);
            }
        };
        tick();
        return () => {
            cancelled = true;
            if (timer) { clearTimeout(timer); }
        };
    }, [partnerId, poll, run]);

    async function runAgain() {
        const result = await run();
        onResultRef.current?.(result ?? [], true);
    }

    const summary = checks ? checksSummary(checks) : null;

    return (
        <Stack gap="sm">
            <Group justify="space-between" wrap="wrap" gap="xs">
                <Group gap={8}>
                    {(running || polling) && <Loader size="xs" />}
                    <Text size="sm" fw={600}>
                        {summary
                            ? t('{{passed}} of {{total}} checks passed', { passed: summary.passed, total: summary.total, interpolation: { escapeValue: false } })
                            : t('Running checks…')}
                    </Text>
                    {polling && <Text size="xs" c="dimmed">{t('Checking again every few seconds')}</Text>}
                </Group>
                {!polling && (
                    <Button size="xs" variant="light" radius="xl" leftSection={<IconRefresh size={14} />} loading={running} onClick={runAgain}>
                        {t('Run again')}
                    </Button>
                )}
            </Group>
            {summary && summary.total > 0 && (
                <Progress
                    value={(summary.passed / summary.total) * 100}
                    color={summary.failed.length > 0 ? 'red' : summary.warnings.length > 0 ? 'yellow' : 'green'}
                    size="sm"
                    radius="xl"
                    aria-label={t('Checks passed')}
                />
            )}
            {error && (
                <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>{error}</Alert>
            )}
            {checks && checks.length === 0 && !error && (
                <Text size="sm" c="dimmed">{t('The server returned no checks for this partner.')}</Text>
            )}
            <Stack gap={6} role="list">
                {(checks ?? []).map((c) => {
                    const v = checkView(c, t);
                    return (
                    <Paper key={c.code} p="sm" radius="md" className="raven-surface raven-surface--tile" role="listitem" style={{ opacity: v.level === 'skipped' ? 0.7 : 1 }}>
                        <Group gap="sm" wrap="nowrap" align="flex-start">
                            <ThemeIcon size="md" radius="xl" variant="light" color={v.color} aria-label={v.label}>
                                <LevelIcon level={v.level} />
                            </ThemeIcon>
                            <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                                <Group gap={6} wrap="wrap">
                                    <Text size="sm" fw={600} c={v.level === 'skipped' ? 'dimmed' : undefined}>{c.title}</Text>
                                    {v.level === 'skipped' && <Text size="xs" c="dimmed">({v.label})</Text>}
                                </Group>
                                {c.detail && <Text size="xs" c="dimmed" style={{ wordBreak: 'break-word' }}>{c.detail}</Text>}
                                {v.showFix && c.fix && (
                                    <Group gap={6} wrap="nowrap" align="flex-start" mt={2}>
                                        <IconTool size={14} style={{ flexShrink: 0, marginTop: 3, opacity: 0.8 }} />
                                        <Text size="xs" style={{ wordBreak: 'break-word' }}>{c.fix}</Text>
                                    </Group>
                                )}
                            </Stack>
                        </Group>
                    </Paper>
                    );
                })}
            </Stack>
        </Stack>
    );
}
