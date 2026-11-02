import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Badge,
    Button,
    Checkbox,
    Code,
    Group,
    Modal,
    NumberInput,
    ScrollArea,
    SegmentedControl,
    SimpleGrid,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import {
    IconAlertTriangle,
    IconFileSpreadsheet,
    IconMapPin,
    IconMessageSearch,
    IconSearch,
    IconSquare,
    IconViewfinder,
    IconX,
} from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import { downloadFile, EmptyState, extractError, formatDateTime, Section } from '../ServerRequests/shared';
import AreaMap, { type AreaMode, type BBox, type Circle } from './AreaMap';

export interface MessageResult {
    id: number;
    timestamp: string | null;
    stale: string | null;
    uid: string | null;
    type: string | null;
    how: string | null;
    callsign: string | null;
    sender_callsign: string | null;
    sender_uid: string | null;
    latitude: number | null;
    longitude: number | null;
    hae: number | null;
    ce: number | null;
    le: number | null;
    course: number | null;
    speed: number | null;
    chatroom: string | null;
    message: string | null;
    remarks: string | null;
    mission: string | null;
    xml?: string;
}

interface SearchResponse {
    results: MessageResult[];
    total: number;
    export_max_rows: number;
}

// Mantine dates gives "YYYY-MM-DD HH:mm:ss" in the browser's local time
function toIso(value: string | null): string | undefined {
    if (!value) { return undefined; }
    const d = new Date(value.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const TYPE_PRESETS = [
    { value: '', label: 'All' },
    { value: 'a-', label: 'Atoms (PLI, markers)' },
    { value: 'b-t-f', label: 'Chat' },
    { value: 'b-a', label: 'Alerts' },
    { value: 'b-r-f-h-c', label: 'CasEvac' },
];

export default function MessageSearch() {
    const { t } = useTranslation();

    const [start, setStart] = useState<string | null>(null);
    const [end, setEnd] = useState<string | null>(null);
    const [type, setType] = useState('');
    const [callsign, setCallsign] = useState('');
    const [uid, setUid] = useState('');
    const [text, setText] = useState('');
    const [areaMode, setAreaMode] = useState<AreaMode>('none');
    const [bbox, setBbox] = useState<BBox | null>(null);
    const [circle, setCircle] = useState<Circle | null>(null);
    const [tracks, setTracks] = useState(true);

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [data, setData] = useState<SearchResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [exporting, setExporting] = useState<string | null>(null);
    const [selected, setSelected] = useState<MessageResult | null>(null);
    // The filters of the last search, so paging and exports match what's shown
    const [applied, setApplied] = useState<Record<string, string | number> | null>(null);

    const params = useMemo(() => {
        const p: Record<string, string | number> = {};
        const s = toIso(start);
        const e = toIso(end);
        if (s) { p.start = s; }
        if (e) { p.end = e; }
        if (type.trim()) { p.type = type.trim(); }
        if (callsign.trim()) { p.callsign = callsign.trim(); }
        if (uid.trim()) { p.uid = uid.trim(); }
        if (text.trim()) { p.text = text.trim(); }
        if (areaMode === 'box' && bbox) {
            Object.assign(p, {
                min_lat: bbox.minLat, min_lon: bbox.minLon, max_lat: bbox.maxLat, max_lon: bbox.maxLon,
            });
        }
        if (areaMode === 'radius' && circle) {
            Object.assign(p, { lat: circle.lat, lon: circle.lon, radius: circle.radius });
        }
        return p;
    }, [start, end, type, callsign, uid, text, areaMode, bbox, circle]);

    const load = useCallback(async (filters: Record<string, string | number>, p: number, size: number) => {
        setLoading(true);
        setError(null);
        try {
            const r = await axios.get<SearchResponse>(apiRoutes.messageSearch, {
                params: { ...filters, page: p, per_page: size },
            });
            setData(r.data);
        } catch (err) {
            setError((await extractError(err)) ?? t('The search failed'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        if (applied) { load(applied, page, pageSize); }
    }, [applied, page, pageSize, load]);

    function search() {
        setPage(1);
        setApplied({ ...params });
    }

    function reset() {
        setStart(null);
        setEnd(null);
        setType('');
        setCallsign('');
        setUid('');
        setText('');
        setAreaMode('none');
        setBbox(null);
        setCircle(null);
    }

    async function exportAs(format: 'csv' | 'kml') {
        setExporting(format);
        try {
            await downloadFile(
                apiRoutes.messageSearchExport,
                { ...(applied ?? params), format, ...(format === 'kml' && tracks ? { tracks: 1 } : {}) },
                `messages.${format}`,
            );
        } catch (err) {
            notifications.show({
                title: t('Export failed'),
                message: (await extractError(err)) ?? t('The export could not be downloaded'),
                color: 'red',
                icon: <IconX />,
            });
        } finally {
            setExporting(null);
        }
    }

    async function openMessage(row: MessageResult) {
        setSelected(row);
        try {
            const r = await axios.get(`${apiRoutes.messageSearch}/${row.id}`);
            setSelected(r.data.message);
        } catch (err) {
            notifications.show({
                title: t('Could not load the message'),
                message: (await extractError(err)) ?? '',
                color: 'red',
                icon: <IconX />,
            });
        }
    }

    const areaIncomplete = (areaMode === 'box' && !bbox) || (areaMode === 'radius' && !circle);
    const overCap = data && data.total > data.export_max_rows;

    return (
        <Stack gap="lg">
            <div>
                <Title order={2}>{t('Message Search')}</Title>
                <Text size="sm" c="dimmed">
                    {t('Search stored CoT by time, area, type, callsign and text, and export the results as CSV or KML')}
                </Text>
            </div>

            <Section title={t('Filters')}>
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
                    <Stack gap="sm">
                        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                            <DateTimePicker
                              label={t('From')}
                              value={start}
                              onChange={setStart}
                              maxDate={end ?? undefined}
                              valueFormat="YYYY-MM-DD HH:mm"
                              clearable
                              placeholder={t('Any time')}
                            />
                            <DateTimePicker
                              label={t('To')}
                              value={end}
                              onChange={setEnd}
                              minDate={start ?? undefined}
                              valueFormat="YYYY-MM-DD HH:mm"
                              clearable
                              placeholder={t('Now')}
                            />
                        </SimpleGrid>
                        <TextInput
                          label={t('CoT type prefix')}
                          description={t('e.g. a-f-G for friendly ground units, b-t-f for chat')}
                          value={type}
                          onChange={(e) => setType(e.currentTarget.value)}
                        />
                        <Group gap={6}>
                            {TYPE_PRESETS.map((preset) => (
                                <Badge
                                  key={preset.value}
                                  variant={type === preset.value ? 'filled' : 'light'}
                                  style={{ cursor: 'pointer' }}
                                  tt="none"
                                  onClick={() => setType(preset.value)}
                                >
                                    {t(preset.label)}
                                </Badge>
                            ))}
                        </Group>
                        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                            <TextInput
                              label={t('Callsign')}
                              value={callsign}
                              onChange={(e) => setCallsign(e.currentTarget.value)}
                            />
                            <TextInput
                              label={t('UID')}
                              value={uid}
                              onChange={(e) => setUid(e.currentTarget.value)}
                            />
                        </SimpleGrid>
                        <TextInput
                          label={t('Text')}
                          description={t('Searches chat messages and marker remarks')}
                          value={text}
                          onChange={(e) => setText(e.currentTarget.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { search(); } }}
                        />
                    </Stack>

                    <Stack gap="sm">
                        <Group justify="space-between" wrap="wrap" gap="xs">
                            <Text size="sm" fw={500}>{t('Area')}</Text>
                            <SegmentedControl
                              size="xs"
                              value={areaMode}
                              onChange={(v) => setAreaMode(v as AreaMode)}
                              data={[
                                  { value: 'none', label: t('Anywhere') },
                                  { value: 'box', label: t('Box') },
                                  { value: 'radius', label: t('Radius') },
                              ]}
                            />
                        </Group>
                        <AreaMap
                          mode={areaMode}
                          bbox={bbox}
                          circle={circle}
                          onBbox={setBbox}
                          onCircle={setCircle}
                          results={data?.results ?? []}
                          onSelect={openMessage}
                        />
                        {areaMode === 'box' && (
                            <>
                                <Text size="xs" c="dimmed">
                                    <IconSquare size={12} /> {t('Hold Shift and drag on the map to draw a box, or use the current view')}
                                </Text>
                                <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
                                    {(['minLat', 'minLon', 'maxLat', 'maxLon'] as const).map((key) => (
                                        <NumberInput
                                          key={key}
                                          size="xs"
                                          label={{ minLat: t('South'), minLon: t('West'), maxLat: t('North'), maxLon: t('East') }[key]}
                                          value={bbox ? bbox[key] : ''}
                                          decimalScale={5}
                                          min={key.endsWith('Lat') ? -90 : -180}
                                          max={key.endsWith('Lat') ? 90 : 180}
                                          onChange={(v) => {
                                              const n = typeof v === 'number' ? v : Number(v);
                                              const base = bbox ?? { minLat: 0, minLon: 0, maxLat: 0, maxLon: 0 };
                                              setBbox({ ...base, [key]: Number.isFinite(n) ? n : 0 });
                                          }}
                                        />
                                    ))}
                                </SimpleGrid>
                            </>
                        )}
                        {areaMode === 'radius' && (
                            <>
                                <Text size="xs" c="dimmed">
                                    <IconMapPin size={12} /> {t('Click the map to set the center')}
                                </Text>
                                <SimpleGrid cols={3} spacing="xs">
                                    <NumberInput
                                      size="xs"
                                      label={t('Latitude')}
                                      value={circle?.lat ?? ''}
                                      decimalScale={5}
                                      min={-90}
                                      max={90}
                                      onChange={(v) => setCircle({ radius: 1000, lon: 0, ...circle, lat: Number(v) || 0 })}
                                    />
                                    <NumberInput
                                      size="xs"
                                      label={t('Longitude')}
                                      value={circle?.lon ?? ''}
                                      decimalScale={5}
                                      min={-180}
                                      max={180}
                                      onChange={(v) => setCircle({ radius: 1000, lat: 0, ...circle, lon: Number(v) || 0 })}
                                    />
                                    <NumberInput
                                      size="xs"
                                      label={t('Radius (m)')}
                                      value={circle?.radius ?? 1000}
                                      min={1}
                                      max={500000}
                                      step={100}
                                      onChange={(v) => setCircle({ lat: 0, lon: 0, ...circle, radius: Number(v) || 1 })}
                                    />
                                </SimpleGrid>
                            </>
                        )}
                    </Stack>
                </SimpleGrid>

                <Group justify="space-between" mt="lg" wrap="wrap" gap="sm">
                    <Group gap="sm">
                        <Button leftSection={<IconSearch size={16} />} onClick={search} loading={loading} disabled={areaIncomplete}>
                            {t('Search')}
                        </Button>
                        <Button variant="default" onClick={reset}>{t('Reset')}</Button>
                    </Group>
                    <Group gap="sm">
                        <Checkbox
                          size="xs"
                          label={t('Tracks in KML')}
                          checked={tracks}
                          onChange={(e) => setTracks(e.currentTarget.checked)}
                        />
                        <Button
                          variant="light"
                          leftSection={<IconFileSpreadsheet size={16} />}
                          onClick={() => exportAs('csv')}
                          loading={exporting === 'csv'}
                          disabled={!data || data.total === 0}
                        >
                            {t('Export CSV')}
                        </Button>
                        <Button
                          variant="light"
                          leftSection={<IconViewfinder size={16} />}
                          onClick={() => exportAs('kml')}
                          loading={exporting === 'kml'}
                          disabled={!data || data.total === 0}
                        >
                            {t('Export KML')}
                        </Button>
                    </Group>
                </Group>
            </Section>

            {error && (
                <Alert color="red" icon={<IconAlertTriangle size={16} />} title={t('Search failed')}>{error}</Alert>
            )}
            {overCap && (
                <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                    {t('{{total}} messages match, but exports stop at the newest {{max}}. Narrow the search to export everything.', {
                        total: data.total.toLocaleString(),
                        max: data.export_max_rows.toLocaleString(),
                    })}
                </Alert>
            )}

            <Section
              title={t('Results')}
              actions={data && <Badge variant="light" tt="none">{t('{{count}} messages', { count: data.total })}</Badge>}
            >
                {!data && !loading ? (
                    <EmptyState
                      icon={<IconMessageSearch size={22} />}
                      title={t('No search yet')}
                      description={t('Set some filters and press Search. Exports use the same filters.')}
                    />
                ) : (
                    <DataTable
                      withTableBorder
                      borderRadius="md"
                      striped
                      highlightOnHover
                      minHeight={180}
                      records={data?.results ?? []}
                      fetching={loading}
                      page={page}
                      onPageChange={setPage}
                      totalRecords={data?.total ?? 0}
                      recordsPerPage={pageSize}
                      recordsPerPageOptions={[25, 50, 100, 250, 500]}
                      onRecordsPerPageChange={(size) => { setPageSize(size); setPage(1); }}
                      onRowClick={({ record }) => openMessage(record)}
                      noRecordsText={t('No messages match these filters')}
                      columns={[
                          { accessor: 'timestamp', title: t('Time'), render: (r) => formatDateTime(r.timestamp, true) },
                          { accessor: 'callsign', title: t('Callsign'), render: (r) => r.callsign ?? '—' },
                          { accessor: 'type', title: t('Type'), render: (r) => <Code>{r.type}</Code> },
                          {
                              accessor: 'position',
                              title: t('Position'),
                              render: (r) => (r.latitude !== null && r.longitude !== null
                                  ? `${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}`
                                  : '—'),
                          },
                          {
                              accessor: 'message',
                              title: t('Message / remarks'),
                              render: (r) => (
                                  <Text size="sm" lineClamp={2}>
                                      {r.chatroom && <Badge size="xs" variant="light" mr={6} tt="none">{r.chatroom}</Badge>}
                                      {r.message ?? r.remarks ?? ''}
                                  </Text>
                              ),
                          },
                          { accessor: 'uid', title: t('UID'), render: (r) => <Text size="xs" c="dimmed">{r.uid}</Text> },
                      ]}
                    />
                )}
            </Section>

            <Modal
              opened={selected !== null}
              onClose={() => setSelected(null)}
              title={selected ? `${selected.callsign ?? selected.uid ?? ''} · ${formatDateTime(selected.timestamp, true)}` : ''}
              size="xl"
            >
                {selected && (
                    <Stack gap="sm">
                        <SimpleGrid cols={2} spacing={4}>
                            {([
                                [t('Type'), selected.type],
                                [t('How'), selected.how],
                                [t('UID'), selected.uid],
                                [t('Sender'), selected.sender_callsign ?? selected.sender_uid],
                                [t('Position'), selected.latitude !== null ? `${selected.latitude}, ${selected.longitude}` : null],
                                [t('Stale'), formatDateTime(selected.stale, true)],
                                [t('Chat room'), selected.chatroom],
                                [t('Mission'), selected.mission],
                            ] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) => (
                                <React.Fragment key={k}>
                                    <Text size="sm" c="dimmed">{k}</Text>
                                    <Text size="sm" style={{ wordBreak: 'break-all' }}>{v}</Text>
                                </React.Fragment>
                            ))}
                        </SimpleGrid>
                        {(selected.message || selected.remarks) && (
                            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{selected.message ?? selected.remarks}</Text>
                        )}
                        <ScrollArea.Autosize mah={360}>
                            <Code block>{selected.xml ?? t('Loading...')}</Code>
                        </ScrollArea.Autosize>
                    </Stack>
                )}
            </Modal>
        </Stack>
    );
}
