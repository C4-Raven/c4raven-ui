import React, { useEffect, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import {Text, Title, Divider, Paper, Flex, Space, ScrollArea, SimpleGrid, Grid, Group, Stack, ThemeIcon, Anchor, Center} from '@mantine/core';
import {
    IconCheck,
    IconX,
    IconCpu,
    IconDatabase,
    IconDeviceFloppy,
    IconClock,
    IconDeviceMobile,
} from '@tabler/icons-react';
import { AreaChart } from '@mantine/charts';
import { parseISO, intervalToDuration, formatDuration, format } from 'date-fns';
import { versions } from '../../_versions';
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import bytes_formatter from '../../bytes_formatter';
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

function StatTile({ icon, value, label, color = 'blue' }: { icon: React.ReactNode; value: React.ReactNode; label: string; color?: string }) {
    return (
        <Paper radius="lg" p="lg" className="raven-surface raven-surface--tile">
            <Group wrap="nowrap">
                <ThemeIcon size={44} radius="md" variant="light" color={color}>
                    {icon}
                </ThemeIcon>
                <Stack gap={0}>
                    <Text size="xl" fw={700}>{value}</Text>
                    <Text size="sm" c="dimmed">{label}</Text>
                </Stack>
            </Group>
        </Paper>
    );
}

const POLL_INTERVAL_MS = 1000;
const HISTORY_LIMIT = 300; // 5 minutes of history at the poll interval above

type UsagePoint = { time: number; cpu: number; memory: number; disk: number; netRecv: number; netSent: number };

export default function Dashboard() {
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
            });
        };

        fetchStatus();
        const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, []);

    return (
        <ScrollArea>
            <Flex justify="space-between" align="center" wrap="wrap" gap="sm" mb="lg">
                <Title order={2}>Server Status</Title>
            </Flex>

            <SimpleGrid cols={{ base: 1, xs: 2, lg: 5 }} mb="xl">
                <StatTile icon={<IconDeviceMobile size={24} />} value={alerts.online_euds} label="Online EUDs" color="blue" />
                <StatTile icon={<IconCpu size={24} />} value={`${serverStatus.cpu_percent}%`} label="CPU Usage" color="orange" />
                <StatTile icon={<IconDatabase size={24} />} value={`${memory.percent}%`} label={`Memory · ${bytes_formatter(memory.used)} used`} color="teal" />
                <StatTile icon={<IconDeviceFloppy size={24} />} value={`${disk.percent}%`} label={`Disk · ${bytes_formatter(disk.used)} used`} color="grape" />
                <StatTile icon={<IconClock size={24} />} value={formatDuration(intervalToDuration({ start: 0, end: uptime.uptime * 1000 }), { format: ['days', 'hours'] })} label="Uptime" color="cyan" />
            </SimpleGrid>

            <Grid mb="xl">
                <Grid.Col span={{ base: 12, md: 8 }}>
                    <Paper radius="lg" p="xl" className="raven-surface" h="100%">
                        <Group justify="space-between" mb="lg">
                            <Title order={4}>Resource Usage</Title>
                            <Text size="xs" c="dimmed">Live · last {Math.round(HISTORY_LIMIT * POLL_INTERVAL_MS / 6000) / 10} min</Text>
                        </Group>
                        <Stack gap="xl">
                            <UsageHistoryChart
                                label="CPU"
                                value={`${serverStatus.cpu_percent}%`}
                                data={history}
                                dataKey="cpu"
                                color="orange"
                            />
                            <UsageHistoryChart
                                label="Memory"
                                value={`${memory.percent}%`}
                                detail={`${bytes_formatter(memory.used)} / ${bytes_formatter(memory.total)}`}
                                data={history}
                                dataKey="memory"
                                color="teal"
                            />
                            <UsageHistoryChart
                                label="Disk"
                                value={`${disk.percent}%`}
                                detail={`${bytes_formatter(disk.used)} / ${bytes_formatter(disk.total)}`}
                                data={history}
                                dataKey="disk"
                                color="grape"
                            />
                            <NetworkHistoryChart
                                label="Network"
                                value={`↓ ${bytes_formatter(network.recvRate, 1, true)}  ↑ ${bytes_formatter(network.sentRate, 1, true)}`}
                                data={history}
                            />
                        </Stack>
                    </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                    <Paper radius="lg" p="xl" className="raven-surface" h="100%">
                        <Title order={4} mb="md">Uptime</Title>
                        <Flex mb="xs"><Text fw={700}>System:</Text><Space w="md" /><Text>{formatDuration(intervalToDuration({ start: 0, end: uptime.uptime * 1000 }))}</Text></Flex>
                        <Flex mb="lg"><Text fw={700}>Boot Time:</Text><Space w="md" /><Text>{uptime.boot_time && parseISO(uptime.boot_time).toLocaleString()}</Text></Flex>
                        <Flex mb="xs"><Text fw={700}>C4 RAVEN:</Text><Space w="md" /><Text>{formatDuration(intervalToDuration({ start: 0, end: ots.uptime * 1000 }))}</Text></Flex>
                        <Flex><Text fw={700}>Since:</Text><Space w="md" /><Text>{ots.start_time}</Text></Flex>
                    </Paper>
                </Grid.Col>
            </Grid>

            <Divider my="lg" />
            <Title mb="lg" order={2}>Server Details</Title>
            <SimpleGrid cols={{ base: 1, lg: 3 }} mb="xl">
                <Paper radius="lg" p="xl" className="raven-surface">
                    <Title order={4} mb="md">uname</Title>
                    <Flex><Text fw={700}>System:</Text><Space w="md" /><Text>{uname.system}</Text></Flex>
                    <Flex><Text fw={700}>Release:</Text><Space w="md" />{uname.release}</Flex>
                    <Flex><Text fw={700}>Version:</Text><Space w="md" />{uname.version}</Flex>
                    <Flex><Text fw={700}>Architecture:</Text><Space w="md" />{uname.machine}</Flex>
                    <Flex><Text fw={700}>Hostname:</Text><Space w="md" />{uname.node}</Flex>
                </Paper>
                <Paper radius="lg" p="xl" className="raven-surface">
                    <Title order={4} mb="md">OS Release</Title>
                    <Flex><Text fw={700}>Name:</Text><Space w="md" /><Text>{osRelease.NAME}</Text></Flex>
                    <Flex><Text fw={700}>Pretty Name:</Text><Space w="md" /><Text>{osRelease.PRETTY_NAME}</Text></Flex>
                    <Flex><Text fw={700}>Version:</Text><Space w="md" /><Text>{osRelease.VERSION}</Text></Flex>
                    <Flex><Text fw={700}>Code Name:</Text><Space w="md" /><Text>{osRelease.VERSION_CODENAME}</Text></Flex>
                </Paper>
                <Paper radius="lg" p="xl" className="raven-surface">
                    <Title order={4} mb="md">C4 RAVEN</Title>
                    <Flex><Text fw={700}>Version:</Text><Space w="md" /><Text>{ots.version}</Text></Flex>
                    <Flex><Text fw={700}>UI Version:</Text><Space w="md" /><Text>{versions.gitTag}</Text></Flex>
                    <Flex><Text fw={700}>UI Commit Hash:</Text><Space w="md" /><Text>{versions.gitCommitHash}</Text></Flex>
                    <Flex><Text fw={700}>UI Commit Date:</Text><Space w="md" /><Text>{parseISO(versions.versionDate).toLocaleString()}</Text></Flex>
                    <Flex><Text fw={700}>Python Version:</Text><Space w="md" /><Text>{ots.python_version}</Text></Flex>
                </Paper>
            </SimpleGrid>

            <Center mt="xl" mb="lg">
                <Text size="xs" c="dimmed" ta="center">
                    Built on <Anchor href="https://github.com/brian7704/OpenTAKServer" target="_blank" rel="noopener noreferrer" size="xs" c="dimmed" td="underline">OpenTAKServer</Anchor> by Brian (brian7704) — we couldn't have done this without his work. Thank you!
                </Text>
            </Center>
        </ScrollArea>
    );
}
