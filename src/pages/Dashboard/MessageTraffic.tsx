import React, { useEffect, useState } from 'react';
import { Group, Paper, SimpleGrid, Text, Title, Tooltip } from '@mantine/core';
import { AreaChart } from '@mantine/charts';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import bytes_formatter from '../../bytes_formatter';

// Server side the samples are once a minute, so polling faster gains nothing
const POLL_INTERVAL_MS = 15000;
const HISTORY_MINUTES = 60;

type RatePoint = {
    timestamp: string;
    received: number;
    sent: number;
    euds_connected: number;
};

type MetricsSummary = {
    totals: {
        cot_received: number;
        cot_sent: number;
        bytes_received: number;
        bytes_sent: number;
        cot_dropped: number;
        auth_failures: number;
        connections_accepted: number;
        cot_parsed: number;
        cot_parse_errors: number;
        data_package_uploads: number;
        data_package_downloads: number;
    };
    received_by_category: Record<string, number>;
    sent_by_category: Record<string, number>;
    dropped_by_reason: Record<string, number>;
    connections: Record<string, number>;
    euds_connected: number;
    rate: { received_per_minute: number | null; sent_per_minute: number | null };
    history: RatePoint[];
    history_minutes: number;
    queue_depth: number | null;
    video_streams_active: number | null;
    database_size: number | null;
    sources: { source: string; last_flush: string; stale: boolean }[];
};

const numberFormat = new Intl.NumberFormat();

function count(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : numberFormat.format(value);
}

function Figure({ label, value, detail, tooltip }: {
    label: string;
    value: React.ReactNode;
    detail?: React.ReactNode;
    tooltip?: string;
}) {
    return (
        <Tooltip label={tooltip} disabled={!tooltip} multiline maw={320} openDelay={400}>
            <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5}>{label}</Text>
                <Text size="1.4rem" fw={700} lh={1.2}>{value}</Text>
                {detail && <Text size="xs" c="dimmed" truncate>{detail}</Text>}
            </div>
        </Tooltip>
    );
}

function byCategory(t: (key: string) => string, values: Record<string, number>): string {
    return ['position', 'chat', 'other']
        .filter((category) => values[category])
        .map((category) => `${t(category)} ${count(values[category])}`)
        .join(' · ');
}

export default function MessageTraffic() {
    const { t } = useTranslation();
    const [summary, setSummary] = useState<MetricsSummary | null>(null);

    useEffect(() => {
        const fetchSummary = () => {
            axios.get(apiRoutes.metricsSummary, { params: { minutes: HISTORY_MINUTES } })
                .then((r) => {
                    if (r.status === 200) {setSummary(r.data);}
                })
                .catch((err) => console.log(err));
        };

        fetchSummary();
        const interval = setInterval(() => {
            if (!document.hidden) {fetchSummary();}
        }, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, []);

    if (!summary) {
        return null;
    }

    const history = summary.history.map((point) => ({
        time: parseISO(point.timestamp).getTime(),
        received: point.received,
        sent: point.sent,
    }));
    const transports = Object.entries(summary.connections)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([transport, value]) => `${transport.toUpperCase()} ${value}`)
        .join(' · ');
    const staleSources = summary.sources.filter((source) => source.stale).map((source) => source.source);
    const rate = (value: number | null) => (value === null ? '—' : `${numberFormat.format(value)}/min`);

    return (
        <Paper radius="lg" p="lg" className="raven-surface">
            <Group justify="space-between" mb="md">
                <Title order={4}>{t('Message traffic')}</Title>
                <Text size="xs" c={staleSources.length ? 'orange.4' : 'dimmed'}>
                    {staleSources.length
                        ? t('Not reporting: {{sources}}', { sources: staleSources.join(', ') })
                        : t('Per minute · last {{minutes}} min', { minutes: summary.history_minutes })}
                </Text>
            </Group>

            <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="lg" mb="lg">
                <Figure
                    label={t('Received')}
                    value={rate(summary.rate.received_per_minute)}
                    detail={`${count(summary.totals.cot_received)} ${t('total')}`}
                    tooltip={byCategory(t, summary.received_by_category)}
                />
                <Figure
                    label={t('Sent')}
                    value={rate(summary.rate.sent_per_minute)}
                    detail={`${count(summary.totals.cot_sent)} ${t('total')}`}
                    tooltip={byCategory(t, summary.sent_by_category)}
                />
                <Figure
                    label={t('Connections')}
                    value={count(Object.values(summary.connections).reduce((a, b) => a + b, 0))}
                    detail={transports || `${count(summary.euds_connected)} ${t('EUDs connected')}`}
                />
                <Figure
                    label={t('Data in / out')}
                    value={`↓ ${bytes_formatter(summary.totals.bytes_received, 1)}`}
                    detail={`↑ ${bytes_formatter(summary.totals.bytes_sent, 1)}`}
                />
                <Figure
                    label={t('Parser queue')}
                    value={count(summary.queue_depth)}
                    detail={`${count(summary.totals.cot_parse_errors)} ${t('parse errors')}`}
                />
                <Figure
                    label={t('Dropped')}
                    value={count(summary.totals.cot_dropped)}
                    detail={`${count(summary.totals.auth_failures)} ${t('auth failures')}`}
                    tooltip={Object.entries(summary.dropped_by_reason)
                        .map(([reason, value]) => `${reason.replace('_', ' ')} ${count(value)}`)
                        .join(' · ')}
                />
            </SimpleGrid>

            {history.length > 1 ? (
                <AreaChart
                    h={160}
                    data={history}
                    dataKey="time"
                    series={[
                        { name: 'received', label: t('Received'), color: 'blue.6' },
                        { name: 'sent', label: t('Sent'), color: 'teal.6' },
                    ]}
                    curveType="monotone"
                    withDots={false}
                    withLegend
                    legendProps={{ verticalAlign: 'top', height: 24 }}
                    withTooltip
                    tooltipProps={{ labelFormatter: (v) => typeof v === 'number' ? format(new Date(v), 'HH:mm') : v }}
                    valueFormatter={(v) => `${numberFormat.format(v)}/min`}
                    withXAxis
                    withYAxis
                    yAxisProps={{ width: 48, tickCount: 3 }}
                    xAxisProps={{ tickFormatter: (v: number) => format(new Date(v), 'HH:mm'), minTickGap: 40 }}
                    gridAxis="x"
                    strokeWidth={2}
                    fillOpacity={0.2}
                />
            ) : (
                <Text size="sm" c="dimmed">{t('The message rate chart fills in over the next few minutes.')}</Text>
            )}

            <Group gap="xl" mt="md">
                <Text size="xs" c="dimmed">
                    {t('Data packages')}: {count(summary.totals.data_package_uploads)} {t('uploaded')} · {count(summary.totals.data_package_downloads)} {t('downloaded')}
                </Text>
                {summary.video_streams_active !== null && (
                    <Text size="xs" c="dimmed">{t('Active video streams')}: {count(summary.video_streams_active)}</Text>
                )}
                {summary.database_size !== null && (
                    <Text size="xs" c="dimmed">{t('Database')}: {bytes_formatter(summary.database_size, 1)}</Text>
                )}
            </Group>
        </Paper>
    );
}
