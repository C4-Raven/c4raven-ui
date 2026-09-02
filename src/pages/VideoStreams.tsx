import {
    ActionIcon,
    AspectRatio,
    Badge,
    Box,
    Button,
    Card,
    Center,
    CopyButton,
    Group,
    Image,
    LoadingOverlay,
    Menu,
    Modal,
    Pagination,
    Select,
    SimpleGrid,
    Stack,
    Switch,
    Text,
    TextInput,
    Title,
    Tooltip,
} from '@mantine/core';
import React, { useEffect, useState } from 'react';
import {
    IconCheck,
    IconCircleMinus,
    IconCopy,
    IconDeviceTv,
    IconLink,
    IconPlayerPlay,
    IconPlus,
    IconVideo,
    IconVideoOff,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import axios from '../axios_config';
import { apiRoutes } from '../apiRoutes';
import { t } from 'i18next';

interface VideoStream {
    thumbnail: string;
    username: string;
    path: string;
    rtsp_link: string;
    webrtc_link: string;
    hls_link: string;
    source: string;
    ready: boolean;
    record: boolean;
}

export default function VideoStreams() {
    const [videoStreams, setVideoStreams] = useState<VideoStream[]>([]);
    const [activePage, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [addVideoOpened, setAddVideoOpened] = useState(false);
    const [deleteVideoOpened, setDeleteVideoOpened] = useState(false);
    const [deletePath, setDeletePath] = useState('');
    const [path, setPath] = useState('');
    const [source, setSource] = useState<string | null>(null);
    const [showVideo, setShowVideo] = useState(false);
    const [videoUrl, setVideoUrl] = useState('');
    const [thumbnail, setThumbnail] = useState('');
    const [thumbnailOpened, setThumbnailOpened] = useState(false);
    const [loading, setLoading] = useState(false);
    const [pageSize, setPageSize] = useState(12);
    const [streamCount, setStreamCount] = useState(0);

    function setRecord(streamPath: string, record: boolean) {
        setLoading(true);
        axios.patch(
            apiRoutes.updateVideoStream,
            { path: streamPath, record, sourceOnDemand: !record }
        ).then(r => {
            setLoading(false);
            if (r.status === 200) {
                notifications.show({
                    message: record ? t(`${streamPath} is now recording`) : t(`${streamPath} is no longer recording`),
                    color: record ? 'green' : 'red',
                });
                getVideoStreams();
            }
        }).catch(err => {
            setLoading(false);
            notifications.show({
                title: t('Recording Failed'),
                message: err.response.data.error,
                color: 'red',
            });
        });
    }

    function getVideoStreams() {
        setLoading(true);
        axios.get(
            apiRoutes.video_streams,
            { params: { page: activePage, per_page: pageSize, sort_by: 'path', sort_direction: 'asc' } }
        ).then(r => {
            setLoading(false);
            if (r.status === 200) {
                setStreamCount(r.data.total);
                setVideoStreams(r.data.results);
                setPage(r.data.current_page);
                setTotalPages(r.data.total_pages);
            }
        }).catch(err => {
            setLoading(false);
            notifications.show({
                title: t('Failed to get video streams'),
                message: err.response.data.error,
                color: 'red',
            });
        });
    }

    useEffect(() => {
        getVideoStreams();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePage]);

    useEffect(() => {
        setPage(1);
        getVideoStreams();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageSize]);

    function deleteVideoStream() {
        setLoading(true);
        axios.delete(
            apiRoutes.deleteVideoStream,
            { params: { path: deletePath } },
        ).then(() => {
            setLoading(false);
            notifications.show({
                message: t('Successfully deleted video stream'),
                color: 'green',
            });
            getVideoStreams();
        }).catch(err => {
            setLoading(false);
            notifications.show({
                title: t('Failed to delete video stream'),
                message: err.response.data.error,
                color: 'red',
            });
        });
    }

    function addVideo(e: any) {
        setLoading(true);
        e.preventDefault();
        axios.post(
            apiRoutes.addVideoStream,
            { path, source, sourceOnDemand: true }
        ).then(r => {
            setLoading(false);
            if (r.status === 200) {
                setAddVideoOpened(false);
                getVideoStreams();
            }
        }).catch(err => {
            setLoading(false);
            notifications.show({
                title: t('Failed to add video stream'),
                message: err.response.data.error,
                color: 'red',
            });
        });
        setPath('');
        setSource(null);
    }

    function startStreaming() {
        window.open(`${window.location.protocol}//${window.location.hostname}:8889/${localStorage.getItem('username')}_browser/publish?jwt=${localStorage.getItem('token')}`, '_blank');
    }

    function watch(stream: VideoStream) {
        setVideoUrl(`${stream.hls_link}?jwt=${localStorage.getItem('token')}`);
        setShowVideo(true);
        setPath(stream.path);
    }

    return (
        <>
            <LoadingOverlay visible={loading} zIndex={1000} overlayProps={{ radius: 'sm', blur: 2, fixed: true }} />

            <Group justify="space-between" mb="lg" wrap="wrap">
                <div>
                    <Title order={2}>{t('Streaming')}</Title>
                    <Text size="sm" c="dimmed">{t('Live and recorded video streams available on this server')}</Text>
                </div>
                <Group>
                    <Tooltip multiline w={220} withArrow label={t("Start streaming in the browser using your device's camera")}>
                        <Button variant="default" onClick={startStreaming} leftSection={<IconVideo size={16} />}>
                            {t('Start Streaming')}
                        </Button>
                    </Tooltip>
                    <Button onClick={() => setAddVideoOpened(true)} leftSection={<IconPlus size={16} />}>
                        {t('Add Video')}
                    </Button>
                </Group>
            </Group>

            {videoStreams.length === 0 && !loading && (
                <Card withBorder radius="lg" p="xl" className="raven-surface">
                    <Center>
                        <Stack align="center" gap={4}>
                            <IconVideoOff size={32} opacity={0.5} />
                            <Text c="dimmed">{t('No video streams yet')}</Text>
                        </Stack>
                    </Center>
                </Card>
            )}

            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="lg">
                {videoStreams.map((stream) => (
                    <Card key={stream.path} withBorder radius="lg" padding={0} className="raven-surface raven-surface--tile raven-surface--interactive" style={{ overflow: 'hidden' }}>
                        <Box
                            pos="relative"
                            style={{ cursor: 'pointer', aspectRatio: '16 / 9', background: 'var(--mantine-color-dark-8)' }}
                            onClick={() => {
                                if (stream.thumbnail) {
                                    setThumbnail(stream.thumbnail);
                                    setThumbnailOpened(true);
                                }
                            }}
                        >
                            {stream.thumbnail ? (
                                <Image src={stream.thumbnail} h="100%" fit="cover" alt={stream.path} />
                            ) : (
                                <Center h="100%">
                                    <IconDeviceTv size={36} opacity={0.35} />
                                </Center>
                            )}

                            <Group gap={6} pos="absolute" top={8} left={8}>
                                <Badge
                                    size="sm"
                                    variant="filled"
                                    color={stream.ready ? 'green' : 'gray'}
                                    leftSection={
                                        <Box
                                            style={{
                                                width: 6,
                                                height: 6,
                                                borderRadius: '50%',
                                                background: 'white',
                                                animation: stream.ready ? 'raven-pulse 1.5s ease-in-out infinite' : undefined,
                                            }}
                                        />
                                    }
                                >
                                    {stream.ready ? t('Live') : t('Offline')}
                                </Badge>
                                {stream.record && <Badge size="sm" variant="filled" color="red">{t('REC')}</Badge>}
                            </Group>

                            <ActionIcon
                                variant="filled"
                                color="dark"
                                size="lg"
                                radius="xl"
                                pos="absolute"
                                top="50%"
                                left="50%"
                                style={{ transform: 'translate(-50%, -50%)', opacity: 0.9 }}
                                onClick={(e) => { e.stopPropagation(); watch(stream); }}
                            >
                                <IconPlayerPlay size={18} />
                            </ActionIcon>
                        </Box>

                        <Stack gap={6} p="md">
                            <div>
                                <Text fw={700} truncate>{stream.path}</Text>
                                <Text size="xs" c="dimmed" truncate>{stream.username} &middot; {stream.source || t('No source')}</Text>
                            </div>

                            <Group justify="space-between" mt={4}>
                                <Tooltip label={stream.record ? t('Recording') : t('Not recording')}>
                                    <Switch
                                        size="sm"
                                        checked={stream.record}
                                        onChange={(e) => setRecord(stream.path, e.currentTarget.checked)}
                                    />
                                </Tooltip>
                                <Group gap={4}>
                                    <Menu shadow="md" position="bottom-end" withinPortal>
                                        <Menu.Target>
                                            <ActionIcon variant="subtle" title={t('Copy stream link')}>
                                                <IconLink size={16} />
                                            </ActionIcon>
                                        </Menu.Target>
                                        <Menu.Dropdown>
                                            <Menu.Label>{t('Copy Link')}</Menu.Label>
                                            {([
                                                ['RTSP', stream.rtsp_link],
                                                ['WebRTC', stream.webrtc_link],
                                                ['HLS', `${stream.hls_link}?jwt=${localStorage.getItem('token')}`],
                                            ] as const).map(([label, link]) => (
                                                <CopyButton key={label} value={link}>
                                                    {({ copied, copy }) => (
                                                        <Menu.Item leftSection={<IconCopy size={14} />} onClick={copy} color={copied ? 'teal' : undefined}>
                                                            {copied ? t(`Copied ${label} Link`) : t(`${label} Link`)}
                                                        </Menu.Item>
                                                    )}
                                                </CopyButton>
                                            ))}
                                        </Menu.Dropdown>
                                    </Menu>
                                    <ActionIcon
                                        variant="subtle"
                                        color="red"
                                        title={t('Delete')}
                                        onClick={() => { setDeleteVideoOpened(true); setDeletePath(stream.path); }}
                                    >
                                        <IconCircleMinus size={16} />
                                    </ActionIcon>
                                </Group>
                            </Group>
                        </Stack>
                    </Card>
                ))}
            </SimpleGrid>

            {videoStreams.length > 0 && (
                <Group justify="space-between" mt="lg">
                    <Select
                        w={140}
                        size="xs"
                        value={String(pageSize)}
                        onChange={(v) => setPageSize(Number(v) || 12)}
                        data={['8', '12', '16', '24', '32'].map((v) => ({ value: v, label: t(`${v} per page`) }))}
                    />
                    <Text size="xs" c="dimmed">{t(`${streamCount} stream(s)`)}</Text>
                    <Pagination total={totalPages} value={activePage} onChange={setPage} size="sm" />
                </Group>
            )}

            <Modal opened={addVideoOpened} onClose={() => setAddVideoOpened(false)} title={t('Add Video')}>
                <Stack gap="sm">
                    <TextInput required label={t('Path')} onChange={e => setPath(e.target.value)} />
                    <TextInput label={t('Source')} onChange={e => setSource(e.target.value)} />
                    <Button onClick={addVideo}>{t('Add Video Stream')}</Button>
                </Stack>
            </Modal>

            <Modal opened={deleteVideoOpened} onClose={() => setDeleteVideoOpened(false)} title={t(`Are you sure you want to delete ${deletePath}?`)}>
                <Center>
                    <Button mr="md" onClick={() => { deleteVideoStream(); setDeleteVideoOpened(false); }}>{t('Yes')}</Button>
                    <Button variant="default" onClick={() => setDeleteVideoOpened(false)}>{t('No')}</Button>
                </Center>
            </Modal>

            <Modal opened={thumbnailOpened} onClose={() => setThumbnailOpened(false)} title={t('Thumbnail')} size="xl">
                <Image src={thumbnail} />
            </Modal>

            {showVideo && (
                <AspectRatio ratio={16 / 9} h="100%" mb="xl" mt="md">
                    <>
                        <iframe
                            src={videoUrl}
                            title={path}
                            style={{ border: 0 }}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                        <Button
                            fullWidth
                            onClick={() => { setShowVideo(false); setVideoUrl(''); }}
                        >
                            {t('Close Stream')}
                        </Button>
                    </>
                </AspectRatio>
            )}
        </>
    );
}
