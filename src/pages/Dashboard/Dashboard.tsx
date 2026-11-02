import React, { useEffect, useRef, useState } from 'react';
import { Text, Title, Paper, SimpleGrid, Group, Stack, Progress, ThemeIcon, Tooltip } from '@mantine/core';
import { IconClock, IconCpu, IconDatabase, IconDeviceMobile, IconServer } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { PulseDot } from '../ServerRequests/shared';
import { AreaChart } from '@mantine/charts';
import { parseISO, intervalToDuration, formatDuration, format } from 'date-fns';
import { versions } from '../../_versions';
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import bytes_formatter from '../../bytes_formatter';
import MessageTraffic from './MessageTraffic';
import '@mantine/charts/styles.css';

function UsageHistoryChart({ label, value, detail, data, dataKey, color }: {
    label: string;
    value: React.ReactNode;
    detail?: React.ReactNode;
    data: UsagePoint[];
    dataKey: 'cpu' | 'memory' | 'disk';
    color: string;
}) {
    return (
        <div>
            <Group justify="space-between" align="flex-end" mb={4}>
                <Text size="sm" c="dimmed">{label}</Text>
                <Group gap="xs" align="baseline">
                    {detail && <Text size="xs" c="dimmed">{detail}</Text>}
                    <Text size="sm" fw={700} c={`${color}.4`}>{value}</Text>
                </Group>
            </Group>
            <AreaChart
                h={110}
                data={data}
                dataKey="time"
                series={[{ name: dataKey, color: `${color}.6` }]}
                curveType="monotone"
                withDots={false}
                withLegend={false}
                withTooltip
                tooltipProps={{ labelFormatter: (v) => typeof v === 'number' ? format(new Date(v), 'HH:mm:ss') : v }}
                withXAxis
                withYAxis
                yAxisProps={{ domain: [0, 100], width: 34, tickCount: 3 }}
                xAxisProps={{ tickFormatter: (v: number) => format(new Date(v), 'HH:mm:ss'), minTickGap: 40 }}
                gridAxis="x"
                strokeWidth={2}
                fillOpacity={0.25}
                unit="%"
            />
        </div>
    );
}

function NetworkHistoryChart({ label, value, data }: {
    label: string;
    value: React.ReactNode;
    data: UsagePoint[];
}) {
    return (
        <div>
            <Group justify="space-between" align="flex-end" mb={4}>
                <Text size="sm" c="dimmed">{label}</Text>
                <Text size="sm" fw={700} c="orange.4">{value}</Text>
            </Group>
            <AreaChart
                h={110}
                data={data}
                dataKey="time"
                series={[
                    { name: 'netRecv', label: 'Download', color: 'orange.6' },
                    { name: 'netSent', label: 'Upload', color: 'yellow.6' },
                ]}
                curveType="monotone"
                withDots={false}
                withLegend
                legendProps={{ verticalAlign: 'top', height: 24 }}
                withTooltip
                tooltipProps={{ labelFormatter: (v) => typeof v === 'number' ? format(new Date(v), 'HH:mm:ss') : v }}
                valueFormatter={(v) => bytes_formatter(v, 1, true)}
                withXAxis
                withYAxis
                yAxisProps={{ width: 60, tickCount: 3, tickFormatter: (v: number) => bytes_formatter(v, 0, true) }}
                xAxisProps={{ tickFormatter: (v: number) => format(new Date(v), 'HH:mm:ss'), minTickGap: 40 }}
                gridAxis="x"
                strokeWidth={2}
                fillOpacity={0.2}
            />
        </div>
    );
}

function usageColor(percent: number): string {
    if (percent >= 90) {return 'red';}
    if (percent >= 75) {return 'orange';}
    return 'teal';
}

function StatTile({ icon, label, value, detail, percent }: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
    detail?: React.ReactNode;
    percent?: number;
}) {
    return (
        <Paper radius="lg" p="md" className="raven-surface raven-surface--tile">
            <Group justify="space-between" align="flex-start" wrap="nowrap" mb={6}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5}>{label}</Text>
                <ThemeIcon variant="light" color="gray" size="md" radius="md">{icon}</ThemeIcon>
            </Group>
            <Text size="1.6rem" fw={700} lh={1.1}>{value}</Text>
            {percent !== undefined && (
                <Progress value={percent} color={usageColor(percent)} size="sm" radius="xl" mt="sm" />
            )}
            {detail && <Text size="xs" c="dimmed" mt={6} truncate>{detail}</Text>}
        </Paper>
    );
}

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
    return (
        <Group justify="space-between" wrap="nowrap" gap="md" py={6} className="raven-detail-row">
            <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>{label}</Text>
            <Tooltip label={value} disabled={!value} multiline maw={360} openDelay={400}>
                <Text size="sm" ff={mono ? 'monospace' : undefined} truncate ta="right">{value || '—'}</Text>
            </Tooltip>
        </Group>
    );
}

function compactDuration(seconds: number): string {
    if (!seconds) {
        return '—';
    }
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) {
        return `${days}d ${hours}h`;
    }
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function humanDuration(seconds: number, units?: Array<'days' | 'hours' | 'minutes'>): string {
    if (!seconds) {return '—';}
    const text = formatDuration(intervalToDuration({ start: 0, end: seconds * 1000 }), units ? { format: units } : undefined);
    return text || '< 1 minute';
}

const POLL_INTERVAL_MS = 1000;
const HISTORY_LIMIT = 300; // 5 minutes of history at the poll interval above

type UsagePoint = { time: number; cpu: number; memory: number; disk: number; netRecv: number; netSent: number };

export default function Dashboard() {
    const { t } = useTranslation();
    const [live, setLive] = useState(true);
    const [uname, setUname] = useState({
        machine: '',
        node: '',
        release: '',
        system: '',
        version: '',
    });
    const [osRelease, setOsRelease] = useState({
        NAME: '',
        PRETTY_NAME: '',
        VERSION: '',
        VERSION_CODENAME: '',
    });
    const [ots, setOts] = useState({
        version: '',
        uptime: 0,
        start_time: '',
        python_version: '',
    });
    const [alerts, setAlerts] = useState({
        online_euds: 0,
    });
    const [serverStatus, setServerStatus] = useState({
        cpu_percent: 0,
    });
    const [disk, setDisk] = useState({
        free: 0,
        used: 0,
        total: 0,
        percent: 0,
    });
    const [memory, setMemory] = useState({
        available: 0,
        free: 0,
        used: 0,
        total: 0,
        percent: 0,
    });
    const [uptime, setUptime] = useState({
        boot_time: '',
        uptime: 0,
    });
    const [history, setHistory] = useState<UsagePoint[]>([]);
    const [network, setNetwork] = useState({ recvRate: 0, sentRate: 0 });
    const prevNetRef = useRef<{ bytesRecv: number; bytesSent: number; time: number } | null>(null);

    useEffect(() => {
        const fetchStatus = () => {
            axios.get(
                apiRoutes.status
            ).then(r => {
                if (r.status === 200) {
                    setLive(true);
                    setAlerts({
                        online_euds: r.data.online_euds,
                    });
                    setServerStatus({ cpu_percent: r.data.cpu_percent });
                    setDisk({
                        free: r.data.disk_usage.free,
                        used: r.data.disk_usage.used,
                        total: r.data.disk_usage.total,
                        percent: r.data.disk_usage.percent,
                    });
                    setMemory({
                        available: r.data.memory.available,
                        free: r.data.memory.free,
                        used: r.data.memory.used,
                        total: r.data.memory.total,
                        percent: r.data.memory.percent,
                    });
                    setOts({
                        version: r.data.ots_version,
                        uptime: r.data.ots_uptime,
                        start_time: parseISO(r.data.ots_start_time).toLocaleString(),
                        python_version: r.data.python_version,
                    });
                    setUptime({
                        uptime: r.data.system_uptime,
                        boot_time: r.data.system_boot_time,
                    });
                    setUname(r.data.uname);
                    setOsRelease(r.data.os_release);

                    const now = Date.now();
                    let recvRate = 0;
                    let sentRate = 0;
                    if (r.data.network) {
                        const prevNet = prevNetRef.current;
                        if (prevNet) {
                            const elapsedSeconds = (now - prevNet.time) / 1000;
                            if (elapsedSeconds > 0) {
                                recvRate = Math.max(0, (r.data.network.bytes_recv - prevNet.bytesRecv) / elapsedSeconds);
                                sentRate = Math.max(0, (r.data.network.bytes_sent - prevNet.bytesSent) / elapsedSeconds);
                            }
                        }
                        prevNetRef.current = { bytesRecv: r.data.network.bytes_recv, bytesSent: r.data.network.bytes_sent, time: now };
                        setNetwork({ recvRate, sentRate });
                    }

                    setHistory(prev => {
                        const next = [...prev, {
                            time: now,
                            cpu: r.data.cpu_percent,
                            memory: r.data.memory.percent,
                            disk: r.data.disk_usage.percent,
                            netRecv: recvRate,
                            netSent: sentRate,
                        }];
                        return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
                    });
                }
            }).catch(err => {
                console.log(err);
                setLive(false);
            });
        };

        fetchStatus();
        // Skip polls while the browser tab is hidden; the charts just resume.
        const interval = setInterval(() => {
            if (!document.hidden) {fetchStatus();}
        }, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, []);

    const historyMinutes = Math.round(HISTORY_LIMIT * POLL_INTERVAL_MS / 6000) / 10;

    return (
        <Stack gap="lg">
            <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
                <div>
                    <Title order={2}>{t('Server Status')}</Title>
                    <Text size="sm" c="dimmed">
                        {[uname.node, osRelease.PRETTY_NAME, ots.version && `C4 RAVEN ${ots.version}`].filter(Boolean).join(' · ')}
                    </Text>
                </div>
                <Group gap={6}>
                    <PulseDot active color={live ? 'var(--mantine-color-green-5)' : 'var(--mantine-color-red-5)'} />
                    <Text size="xs" c="dimmed">{live ? t('Live') : t('Server not responding')}</Text>
                </Group>
            </Group>

            <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="md">
                <StatTile icon={<IconDeviceMobile size={16} />} label={t('Online EUDs')} value={alerts.online_euds} />
                <StatTile icon={<IconCpu size={16} />} label={t('CPU')} value={`${serverStatus.cpu_percent}%`} percent={serverStatus.cpu_percent} />
                <StatTile
                    icon={<IconServer size={16} />}
                    label={t('Memory')}
                    value={`${memory.percent}%`}
                    percent={memory.percent}
                    detail={`${bytes_formatter(memory.used)} / ${bytes_formatter(memory.total)}`}
                />
                <StatTile
                    icon={<IconDatabase size={16} />}
                    label={t('Disk')}
                    value={`${disk.percent}%`}
                    percent={disk.percent}
                    detail={`${bytes_formatter(disk.free)} ${t('free')}`}
                />
                <StatTile
                    icon={<IconClock size={16} />}
                    label={t('Uptime')}
                    value={compactDuration(uptime.uptime)}
                    detail={`${t('C4 RAVEN')} ${humanDuration(ots.uptime, ['days', 'hours', 'minutes'])}`}
                />
            </SimpleGrid>

            <MessageTraffic />

            <Paper radius="lg" p="lg" className="raven-surface">
                <Group justify="space-between" mb="md">
                    <Title order={4}>{t('Resource usage')}</Title>
                    <Text size="xs" c="dimmed">{t('Live · last {{minutes}} min', { minutes: historyMinutes })}</Text>
                </Group>
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl" verticalSpacing="lg">
                    <UsageHistoryChart label={t('CPU')} value={`${serverStatus.cpu_percent}%`} data={history} dataKey="cpu" color="orange" />
                    <UsageHistoryChart
                        label={t('Memory')}
                        value={`${memory.percent}%`}
                        detail={`${bytes_formatter(memory.used)} / ${bytes_formatter(memory.total)}`}
                        data={history}
                        dataKey="memory"
                        color="teal"
                    />
                    <UsageHistoryChart
                        label={t('Disk')}
                        value={`${disk.percent}%`}
                        detail={`${bytes_formatter(disk.used)} / ${bytes_formatter(disk.total)}`}
                        data={history}
                        dataKey="disk"
                        color="grape"
                    />
                    <NetworkHistoryChart
                        label={t('Network')}
                        value={`↓ ${bytes_formatter(network.recvRate, 1, true)}  ↑ ${bytes_formatter(network.sentRate, 1, true)}`}
                        data={history}
                    />
                </SimpleGrid>
            </Paper>

            <Paper radius="lg" p="lg" className="raven-surface">
                <Title order={4} mb="md">{t('Server details')}</Title>
                <SimpleGrid cols={{ base: 1, md: 3 }} spacing="xl">
                    <div>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5} mb={4}>{t('C4 RAVEN')}</Text>
                        <DetailRow label={t('Server version')} value={ots.version} mono />
                        <DetailRow label={t('UI version')} value={versions.gitTag} mono />
                        <DetailRow label={t('UI commit')} value={versions.gitCommitHash?.slice(0, 10)} mono />
                        <DetailRow label={t('UI built')} value={versions.versionDate && parseISO(versions.versionDate).toLocaleString()} />
                        <DetailRow label={t('Python')} value={ots.python_version} mono />
                        <DetailRow label={t('Running since')} value={ots.start_time} />
                    </div>
                    <div>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5} mb={4}>{t('Operating system')}</Text>
                        <DetailRow label={t('Name')} value={osRelease.PRETTY_NAME || osRelease.NAME} />
                        <DetailRow label={t('Version')} value={osRelease.VERSION} />
                        <DetailRow label={t('Code name')} value={osRelease.VERSION_CODENAME} />
                        <DetailRow label={t('Booted')} value={uptime.boot_time && parseISO(uptime.boot_time).toLocaleString()} />
                    </div>
                    <div>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5} mb={4}>{t('Kernel')}</Text>
                        <DetailRow label={t('Hostname')} value={uname.node} mono />
                        <DetailRow label={t('System')} value={uname.system} />
                        <DetailRow label={t('Release')} value={uname.release} mono />
                        <DetailRow label={t('Architecture')} value={uname.machine} mono />
                        <DetailRow label={t('Build')} value={uname.version} mono />
                    </div>
                </SimpleGrid>
            </Paper>
        </Stack>
    );
}
