import {
    ActionIcon,
    Button,
    Grid,
    Group,
    Modal, MultiSelect,
    Paper,
    PasswordInput,
    Select,
    Stack,
    Switch,
    Table,
    TableData,
    TagsInput,
    TextInput, Title, Tooltip,
    ComboboxItem,
    CopyButton,
    Text,
    FileButton,
    Center,
} from '@mantine/core';
import React, { useEffect, useState } from 'react';
import {
    IconCheck,
    IconCopy,
    IconFileUpload,
    IconFilter,
    IconKey,
    IconPassword,
    IconPlus,
    IconQrcode,
    IconTrash,
    IconUserCog,
    IconUserMinus,
    IconUserPlus,
    IconUsersMinus,
    IconX
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { QRCode } from 'react-qrcode-logo';
import axios from '../axios_config';
import { apiRoutes } from '../apiRoutes';
import {t} from "i18next";
import {Link} from "react-router";
import { DataTable, type DataTableSortStatus } from 'mantine-datatable';

export interface User {
    username: string;
    roles: { name: string }[];
    active: boolean;
    site_access: boolean;
    last_login_at: string | null;
    last_login_ip: string | null;
    current_login_at: string | null;
    current_login_ip: string | null;
    login_count: number;
    euds: { uid: string; callsign: string | null }[];
}

// System/service accounts (e.g. "Server", used to send files) that admins
// can't modify from this page — keep in sync with RAVEN_PROTECTED_USERNAMES
// on the backend, which is the actual enforcement point.
const PROTECTED_USERNAMES = ['Server'];
const isProtectedUser = (username: string) => PROTECTED_USERNAMES.includes(username);

export default function Users() {
    const [users, setUsers] = useState<User[]>([]);
    const [userCount, setUserCount] = useState<number>(0);
    const [activePage, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [sortStatus, setSortStatus] = useState<DataTableSortStatus<User>>({
        columnAccessor: 'username',
        direction: 'asc',
    });
    const [addUserOpen, setAddUserOpen] = useState(false);
    const [showDeleteUser, setShowDeleteUser] = useState(false);
    const [tempPasswordInfo, setTempPasswordInfo] = useState<{ username: string; password: string } | null>(null);
    const [showManageGroups, setShowManageGroups] = useState(false);
    const [showManageFilters, setShowManageFilters] = useState(false);
    const [newFilterName, setNewFilterName] = useState('');
    const [showSendFile, setShowSendFile] = useState(false);
    const [sendFileUsername, setSendFileUsername] = useState('');
    const [sendFileFile, setSendFileFile] = useState<File | null>(null);
    const [sendingFile, setSendingFile] = useState(false);
    const [showJoinQr, setShowJoinQr] = useState(false);
    const [joinQrUsername, setJoinQrUsername] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirm_password, setConfirmPassword] = useState('');
    const [role, setRole] = useState('user');
    const [allGroups, setAllGroups] = useState<ComboboxItem[]>([])
    const [groups, setGroups] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [memberships, setMemberships] = useState<TableData>({
        caption: '',
        head: [t('Group Name'), t('Direction'), t('Active')],
        body: [],
    });
    const [userFilters, setUserFilters] = useState<{ id: number; name: string; usernames: string[] }[]>([]);
    const [activeFilterId, setActiveFilterId] = useState<string | null>(null);

    function getUserFilters() {
        axios.get(apiRoutes.userFilters).then((r) => {
            setUserFilters(r.data);
        }).catch((err) => {
            console.log(err);
        });
    }

    // Which filters a given username currently belongs to, by name --
    // what the per-row TagsInput both displays and diffs against.
    function filterNamesFor(user: string): string[] {
        return userFilters.filter((f) => f.usernames.includes(user)).map((f) => f.name);
    }

    // TagsInput hands back the full desired tag list on every change --
    // diff it against what the user is actually in and make only the
    // add/remove calls that changed, creating a new filter by that name
    // the first time it's used (see the backend's PUT /api/users/filters).
    function setUserFilterTags(targetUsername: string, nextNames: string[]) {
        const current = filterNamesFor(targetUsername);
        const toAdd = nextNames.filter((n) => !current.includes(n));
        const toRemove = current.filter((n) => !nextNames.includes(n));
        Promise.all([
            ...toAdd.map((filter_name) => axios.put(apiRoutes.userFilters, { username: targetUsername, filter_name })),
            ...toRemove.map((filter_name) => axios.delete(apiRoutes.userFilters, { params: { username: targetUsername, filter_name } })),
        ]).then(() => {
            getUserFilters();
        }).catch((err) => {
            notifications.show({
                title: t('Failed to update filters for {{username}}', { username: targetUsername }),
                message: err.response?.data?.error,
                icon: <IconX />,
                color: 'red',
            });
        });
    }

    function createFilter() {
        if (!newFilterName.trim()) return;
        axios.post(apiRoutes.userFilters, { name: newFilterName.trim() }).then(() => {
            setNewFilterName('');
            getUserFilters();
        }).catch((err) => {
            notifications.show({
                title: t('Failed to create filter'),
                message: err.response?.data?.error,
                icon: <IconX />,
                color: 'red',
            });
        });
    }

    function deleteFilter(filterId: number) {
        axios.delete(`${apiRoutes.userFilters}/${filterId}`).then(() => {
            if (activeFilterId === String(filterId)) setActiveFilterId(null);
            getUserFilters();
        }).catch((err) => {
            notifications.show({
                title: t('Failed to delete filter'),
                message: err.response?.data?.error,
                icon: <IconX />,
                color: 'red',
            });
        });
    }

    function getUsers() {
        setLoading(true);
        axios.get(apiRoutes.users, {
            params: {
                page: activePage,
                per_page: pageSize,
                sort_by: sortStatus.columnAccessor,
                sort_direction: sortStatus.direction,
                filter_id: activeFilterId,
            }
        }).then(r => {
            setLoading(false);
            if (r.status === 200) {
                setUsers(r.data.results);
                setPage(r.data.current_page);
                setTotalPages(r.data.total_pages);
                setUserCount(r.data.total);
            }
        }).catch((err) => {
            setLoading(false);
            console.log(err);
            notifications.show({
                title: t('Failed to get users'),
                message: err.response.data.error,
                icon: <IconX />,
                color: 'red',
            });
        });
    }

    useEffect(() => { getUserFilters(); }, []);
    useEffect(() => { setPage(1); getUsers(); }, [pageSize]);
    useEffect(() => { setPage(1); getUsers(); }, [activeFilterId]);
    useEffect(() => { getUsers(); }, [activePage, sortStatus]);

    function getAllGroups() {
        axios.get(apiRoutes.allGroups).then(r => {
            if (r.status === 200) {
                const all_groups: ComboboxItem[] = [];
                r.data.map((row: any) => {
                    all_groups.push(row.name);
                })
                setAllGroups(all_groups);
            }
        }).catch(err => {
            console.log(err);
            notifications.show({
                title: t('Failed to get group list'),
                message: err.response.data.error,
                icon: <IconX />,
                color: 'red',
            })
        });
    }

    function removeUserFromGroup(username: string, group_name: string, direction: string) {
        axios.delete(apiRoutes.groupMembers, {params: {username, group_name, direction}}).then((r) => {
            if (r.status === 200) {
                getMemberships(username);
            }
        }).catch(err => {
            console.log(err);
            notifications.show({
                title: t('Failed remove user from group'),
                message: err.response.data.error,
                icon: <IconX />,
                color: 'red',
            })
        });
    }

    function getMemberships(user_name: string) {
        axios.get(apiRoutes.userGroups,{params: {username: user_name}}).then(r => {
            if (r.status === 200) {
                const tableData: TableData = {
                    caption: '',
                    head: [t('Group Name'), t('Direction'), t('Active')],
                    body: [],
                };

                // Consolidate the IN and OUT rows the API returns for the same
                // group into one row -- Tx/Rx when both are present (mutual),
                // otherwise just whichever single direction this user has.
                const byGroup = new Map<string, { directions: Set<string>; active: boolean }>();
                r.data.results.forEach((row: any) => {
                    const existing = byGroup.get(row.group_name);
                    if (existing) {
                        existing.directions.add(row.direction);
                    } else {
                        byGroup.set(row.group_name, { directions: new Set([row.direction]), active: row.active });
                    }
                });

                byGroup.forEach(({ directions, active }, group_name) => {
                    const label = directions.has('IN') && directions.has('OUT')
                        ? t('Tx/Rx')
                        : directions.has('IN') ? t('Tx (send)') : t('Rx (receive)');

                    const active_switch = <Tooltip refProp="rootRef" label={t("This membership can be activated or deactivated from the user's EUD")}>
                        <Switch
                            checked={active}
                        />
                    </Tooltip>

                    const delete_button = <Button
                        color="red"
                        onClick={() => { directions.forEach((direction) => removeUserFromGroup(user_name, group_name, direction)); }}
                        key={`${group_name}_remove`}
                        rightSection={<IconUsersMinus size={14} />}
                    >Remove</Button>;

                    tableData.body?.push([group_name, label, active_switch, delete_button]);
                })

                setMemberships(tableData);
            }
        })
    }

    function addUserToGroups(direction: string) {
        axios.put(apiRoutes.userGroups, {username, direction, groups}).then(r => {
            if (r.status === 200) {
                getMemberships(username);
                setGroups([]);
            }
        }).catch(err => {
            console.log(err);
            notifications.show({
                title: t('Failed to add user to group'),
                message: err.response.data.error,
                icon: <IconX />,
                color: 'red',
            })
        });
    }

    function deleteUser() {
        axios.post(apiRoutes.deleteUser, { username })
            .then(r => {
                if (r.status === 200) {
                    notifications.show({
                        message: t('Successfully deleted user'),
                        icon: <IconCheck />,
                        color: 'green',
                    });
                    getUsers();
                }
            }).catch(err => {
            console.log(err);
            notifications.show({
                title: t('Failed to delete user'),
                message: err.response.data.error,
                icon: <IconX />,
                color: 'red',
            });
        });
    }

    function addUser(e:any) {
        e.preventDefault();
        axios.post(
            apiRoutes.addUser,
            { username, password, confirm_password, roles: [role] }
        ).then(r => {
            if (r.status === 200) {
                setPassword('');
                setConfirmPassword('');
                setAddUserOpen(false);
                getUsers();
            }
        }).catch(err => {
            notifications.show({
                title: t('Failed to add user'),
                message: err.response.data.error,
                color: 'red',
            });
        });
    }

    function changeRole(username:string, role:string) {
        axios.post(
            apiRoutes.changeRole,
            { username, roles: [role] }
        ).then(r => {
            if (r.status === 200) {
                getUsers();
                notifications.show({
                    message: `Changed ${username}'s role to ${role}`,
                    color: 'green',
                });
            }
        }).catch(err => {
            notifications.show({
                title: `Failed to change ${username}'s role`,
                message: err.response.data.error,
                color: 'red',
            });
        });
    }

    function deactivateUser(username:string) {
        axios.post(
            apiRoutes.deactivateUser,
            { username }
        ).then(r => {
            if (r.status === 200) {
                getUsers();
                notifications.show({
                    message: `${username} has been deactivated`,
                    color: 'green',
                });
            }
        }).catch(err => {
            notifications.show({
                title: `Failed to deactivate ${username}`,
                message: err.response.data.error,
                color: 'red',
            });
        });
    }

    function activateUser(username:string) {
        axios.post(
            apiRoutes.activateUser,
            { username }
        ).then(r => {
            if (r.status === 200) {
                getUsers();
                notifications.show({
                    message: `${username} has been activated`,
                    color: 'green',
                });
            }
        }).catch(err => {
            notifications.show({
                title: `Failed to activate ${username}`,
                message: err.response.data.error,
                color: 'red',
            });
        });
    }

    function grantSiteAccess(username:string) {
        axios.post(
            apiRoutes.grantSiteAccess,
            { username }
        ).then(r => {
            if (r.status === 200) {
                getUsers();
                notifications.show({
                    message: `${username} has been granted website access`,
                    color: 'green',
                });
            }
        }).catch(err => {
            notifications.show({
                title: `Failed to grant ${username} website access`,
                message: err.response.data.error,
                color: 'red',
            });
        });
    }

    function revokeSiteAccess(username:string) {
        axios.post(
            apiRoutes.revokeSiteAccess,
            { username }
        ).then(r => {
            if (r.status === 200) {
                getUsers();
                notifications.show({
                    message: `${username}'s website access has been revoked`,
                    color: 'green',
                });
            }
        }).catch(err => {
            notifications.show({
                title: `Failed to revoke ${username}'s website access`,
                message: err.response.data.error,
                color: 'red',
            });
        });
    }

    function forcePasswordReset(username: string) {
        axios.post(
            apiRoutes.forcePasswordReset,
            { username }
        ).then(r => {
            if (r.status === 200) {
                notifications.show({
                    message: `${username} will be asked to set a new password next time they log in`,
                    color: 'green',
                });
            }
        }).catch(err => {
            notifications.show({
                title: `Failed to flag ${username} for a password reset`,
                message: err.response.data.error,
                color: 'red',
            });
        });
    }

    function sendFileToUser() {
        if (!sendFileFile) { return; }
        setSendingFile(true);
        const formData = new FormData();
        formData.append('username', sendFileUsername);
        formData.append('file', sendFileFile);
        axios.post(apiRoutes.sendFileToUser, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
            .then(r => {
                setSendingFile(false);
                if (r.status === 200) {
                    notifications.show({
                        message: `${sendFileFile.name} sent to ${sendFileUsername}`,
                        icon: <IconCheck />,
                        color: 'green',
                    });
                    setShowSendFile(false);
                    setSendFileFile(null);
                }
            }).catch(err => {
                setSendingFile(false);
                notifications.show({
                    title: `Failed to send file to ${sendFileUsername}`,
                    message: err.response.data.error,
                    icon: <IconX />,
                    color: 'red',
                });
            });
    }

    // ATAK/WinTAK only -- an iTAK variant was tried (a best-effort guess at
    // its bundle identifier convention, since it's a separate app from ATAK
    // with no authoritative QR format reference available here) and
    // confirmed not to work, so it's been removed rather than leave a
    // non-functional option in the UI.
    function generateJoinQr(targetUsername: string) {
        // Deliberately doesn't embed a certificate or password -- just the
        // server address and username. The device still authenticates via
        // /Marti/api/tls on port 8446 (see certificate_enrollment_api.py and
        // the ots_certificate_enrollment nginx config) with the user's own
        // password, and gets issued a real client cert as part of that --
        // this QR just saves them typing the host and username in by hand.
        setJoinQrUsername(targetUsername);
        setShowJoinQr(true);
    }

    function buildJoinQrValue(targetUsername: string): string {
        const host = `${window.location.hostname}:8446`;
        return `tak://com.atakmap.app/enroll?host=${encodeURIComponent(host)}&username=${encodeURIComponent(targetUsername)}`;
    }

    function issueTempPassword(username: string) {
        axios.post(
            apiRoutes.issueTempPassword,
            { username }
        ).then(r => {
            if (r.status === 200) {
                setTempPasswordInfo({ username, password: r.data.password });
            }
        }).catch(err => {
            notifications.show({
                title: `Failed to issue a temporary password for ${username}`,
                message: err.response.data.error,
                color: 'red',
            });
        });
    }

    return (
        <>
            <Group mb="md" justify="space-between">
                <Group>
                    <Button onClick={() => { setAddUserOpen(true); }} leftSection={<IconUserPlus size={14} />}>{t('Add User')}</Button>
                    <Button onClick={() => { setShowManageFilters(true); }} variant="light" leftSection={<IconFilter size={14} />}>{t('Manage Filters')}</Button>
                </Group>
                <Select
                    placeholder={t('All users')}
                    clearable
                    w={220}
                    value={activeFilterId}
                    onChange={setActiveFilterId}
                    data={userFilters.map((f) => ({ value: String(f.id), label: f.name }))}
                />
            </Group>
            <Modal opened={showManageFilters} onClose={() => setShowManageFilters(false)} title={t('Manage Filters')}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
                    <TextInput
                        style={{ flex: 1 }}
                        label={t('New filter name')}
                        value={newFilterName}
                        onChange={(e) => setNewFilterName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') createFilter(); }}
                    />
                    <Button leftSection={<IconPlus size={16} />} onClick={createFilter} disabled={!newFilterName.trim()}>{t('Create')}</Button>
                </div>
                <Stack gap="xs">
                    {userFilters.length === 0 ? (
                        <Text size="sm" c="dimmed">{t('No filters yet — create one above.')}</Text>
                    ) : userFilters.map((f) => (
                        <Paper key={f.id} p="sm" radius="md" className="raven-surface raven-surface--tile" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <Text fw={600} style={{ flex: 1 }}>
                                {f.name}
                                <Text component="span" size="xs" c="dimmed" ml={6}>
                                    {t('({{count}} members)', { count: f.usernames.length })}
                                </Text>
                            </Text>
                            <Tooltip label={t('Delete filter')}>
                                <ActionIcon color="red" variant="subtle" onClick={() => deleteFilter(f.id)}>
                                    <IconTrash size={16} />
                                </ActionIcon>
                            </Tooltip>
                        </Paper>
                    ))}
                </Stack>
            </Modal>
            <Table.ScrollContainer minWidth="100%">
            <DataTable
                withTableBorder
                borderRadius="md"
                shadow="sm"
                striped
                highlightOnHover
                horizontalSpacing="xs"
                scrollAreaProps={{ type: 'auto', offsetScrollbars: true }}
                storeColumnsKey="users-table-columns"
                defaultColumnProps={{ resizable: true }}
                records={users}
                columns={[
                    {
                        accessor: 'username',
                        title: t('Username'),
                        sortable: true,
                        render: (row) => <Link to={`/profile/${row.username}`}>{row.username}</Link>,
                    },
                    {
                        accessor: 'filters',
                        title: t('Filters'),
                        render: (row) => (
                            <TagsInput
                                variant="unstyled"
                                placeholder={t('Add to filter…')}
                                data={userFilters.map((f) => f.name)}
                                value={filterNamesFor(row.username)}
                                onChange={(names) => setUserFilterTags(row.username, names)}
                            />
                        ),
                    },
                    {
                        accessor: 'callsign',
                        title: t('Callsign'),
                        render: (row) => {
                            const callsigns = (row.euds ?? [])
                                .map((eud) => eud.callsign)
                                .filter((callsign): callsign is string => !!callsign);
                            return callsigns.length
                                ? <Text size="sm">{callsigns.join(', ')}</Text>
                                : <Text size="sm" c="dimmed">—</Text>;
                        },
                    },
                    {
                        accessor: 'role',
                        title: t('Role'),
                        render: (row) => row.username === localStorage.getItem('username') || isProtectedUser(row.username)
                            ? row.roles[0]?.name
                            : (
                                <Select
                                    value={row.roles[0]?.name}
                                    onChange={(_value, option) => { changeRole(row.username, option.value); }}
                                    data={[{ value: 'administrator', label: 'Administrator' }, { value: 'user', label: 'User' }]}
                                    placeholder="Role"
                                />
                            ),
                    },
                    {
                        accessor: 'active',
                        title: t('Active'),
                        render: (row) => (
                            <Switch
                                disabled={row.username === localStorage.getItem('username') || isProtectedUser(row.username)}
                                checked={row.active}
                                onChange={(e) => {
                                    if (e.target.checked) { activateUser(row.username); } else { deactivateUser(row.username); }
                                }}
                            />
                        ),
                    },
                    {
                        accessor: 'site_access',
                        title: t('Website Access'),
                        render: (row) => (
                            <Tooltip label={t('Controls access to this website only — EUDs and TAK clients are unaffected')}>
                                <Switch
                                    disabled={row.username === localStorage.getItem('username') || isProtectedUser(row.username)}
                                    checked={row.site_access}
                                    onChange={(e) => {
                                        if (e.target.checked) { grantSiteAccess(row.username); } else { revokeSiteAccess(row.username); }
                                    }}
                                />
                            </Tooltip>
                        ),
                    },
                    {
                        accessor: 'current_login_ip',
                        title: t('Last IP'),
                        sortable: true,
                        render: (row) => <Text ff="monospace" size="sm">{row.current_login_ip ?? '—'}</Text>,
                    },
                    {
                        accessor: 'actions',
                        title: '',
                        textAlign: 'right',
                        render: (row) => (
                            <Group gap={4} wrap="nowrap" justify="flex-end">
                                <Tooltip label={t('Force this user to set a new password on next login')}>
                                    <ActionIcon
                                        variant="subtle"
                                        disabled={isProtectedUser(row.username)}
                                        onClick={() => forcePasswordReset(row.username)}
                                    >
                                        <IconPassword size={16} />
                                    </ActionIcon>
                                </Tooltip>
                                <Tooltip label={t('Issue a temporary password (for a user who forgot theirs)')}>
                                    <ActionIcon
                                        variant="subtle"
                                        disabled={isProtectedUser(row.username)}
                                        onClick={() => issueTempPassword(row.username)}
                                    >
                                        <IconKey size={16} />
                                    </ActionIcon>
                                </Tooltip>
                                <Tooltip label={t('Manage groups')}>
                                    <ActionIcon
                                        variant="light"
                                        disabled={isProtectedUser(row.username)}
                                        onClick={() => {
                                            setShowManageGroups(true);
                                            getAllGroups();
                                            getMemberships(row.username);
                                            setUsername(row.username);
                                        }}
                                    >
                                        <IconUserCog size={16} />
                                    </ActionIcon>
                                </Tooltip>
                                <Tooltip label={t('Generate a QR code this user can scan in ATAK/WinTAK to join the server')}>
                                    <ActionIcon
                                        variant="light"
                                        disabled={isProtectedUser(row.username)}
                                        onClick={() => generateJoinQr(row.username)}
                                    >
                                        <IconQrcode size={16} />
                                    </ActionIcon>
                                </Tooltip>
                                <Tooltip label={t('Send this user a file — it will be pushed to their TAK device(s)')}>
                                    <ActionIcon
                                        variant="light"
                                        onClick={() => {
                                            setSendFileUsername(row.username);
                                            setSendFileFile(null);
                                            setShowSendFile(true);
                                        }}
                                    >
                                        <IconFileUpload size={16} />
                                    </ActionIcon>
                                </Tooltip>
                                <Tooltip label={row.username === localStorage.getItem('username') ? t("You can't delete your own account") : t('Delete user')}>
                                    <ActionIcon
                                        color="red"
                                        variant="light"
                                        disabled={row.username === localStorage.getItem('username') || isProtectedUser(row.username)}
                                        onClick={() => {
                                            setUsername(row.username);
                                            setShowDeleteUser(true);
                                        }}
                                    >
                                        <IconUserMinus size={16} />
                                    </ActionIcon>
                                </Tooltip>
                            </Group>
                        ),
                    },
                ]}
                page={activePage}
                onPageChange={(p) => setPage(p)}
                onRecordsPerPageChange={setPageSize}
                totalRecords={userCount}
                recordsPerPage={pageSize}
                recordsPerPageOptions={[10, 15, 20, 25, 30, 35, 40, 45, 50]}
                sortStatus={sortStatus}
                onSortStatusChange={setSortStatus}
                fetching={loading}
                minHeight={180}
            />
            </Table.ScrollContainer>
            <Modal size="lg" opened={showManageGroups} onClose={() => setShowManageGroups(false)} title={`Manage Groups for ${username}`}>
                <Paper p="md" mb="md" className="raven-surface raven-surface--tile">
                    <Grid align="flex-end" justify="space-between">
                        <Grid.Col span={10}>
                            <Title order={6} mb="md">{t("Direction")}: {t("Tx (send)")}</Title>
                            <MultiSelect
                                placeholder={t("Search")}
                                searchable
                                clearable
                                nothingFoundMessage={t("Nothing found...")}
                                label={t("Select Groups")}
                                onChange={(value) => {setGroups(value)}}
                                data={allGroups} />
                        </Grid.Col>
                        <Grid.Col span={2}>
                            <Button onClick={() => addUserToGroups("IN")}>{t("Add")}</Button>
                        </Grid.Col>
                    </Grid>
                </Paper>
                <Paper p="md" mb="md" className="raven-surface raven-surface--tile">
                    <Grid align="flex-end" justify="space-between">
                        <Grid.Col span={10}>
                            <Title order={6} mb="md">{t("Direction")}: {t("Rx (receive)")}</Title>
                            <MultiSelect
                                placeholder={t("Search")}
                                searchable
                                clearable
                                nothingFoundMessage={t("Nothing found...")}
                                label={t("Select Groups")}
                                onChange={(value) => {setGroups(value)}}
                                data={allGroups} />
                        </Grid.Col>
                        <Grid.Col span={2}>
                            <Button onClick={() => addUserToGroups("OUT")}>{t("Add")}</Button>
                        </Grid.Col>
                    </Grid>
                </Paper>
                <Title order={4} mb="md">{t("Memberships")}</Title>
                <DataTable
                    withTableBorder
                    borderRadius="md"
                    striped
                    highlightOnHover
                    storeColumnsKey="users-memberships-table-columns"
                    defaultColumnProps={{ resizable: true }}
                    records={memberships.body?.map((row: any[], idx: number) => ({
                        id: idx,
                        group_name: row[0],
                        direction: row[1],
                        active: row[2],
                        actions: row[3],
                    }))}
                    columns={[
                        { accessor: 'group_name', title: t('Group Name') },
                        { accessor: 'direction', title: t('Direction') },
                        { accessor: 'active', title: t('Active') },
                        { accessor: 'actions', title: '' },
                    ]}
                    minHeight={120}
                />
            </Modal>
            <Modal opened={addUserOpen} onClose={() => setAddUserOpen(false)} title={t("Add User")}>
                <Stack gap="md">
                    <TextInput required label={t("Username")} onChange={e => { setUsername(e.target.value); }} />
                    <PasswordInput
                      label={t("Password")}
                      required
                      onChange={(e) => setPassword(e.target.value)}
                      value={password}
                    />
                    <PasswordInput
                      label={t("Confirm Password")}
                      required
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      value={confirm_password}
                    />
                    <Select
                      label={t("Role")}
                      data={['user', 'administrator']}
                      defaultValue="user"
                      allowDeselect={false}
                      onChange={(_value, option) => { setRole(option.value); }}
                    />
                    <Group justify="flex-end" mt="xs">
                        <Button variant="default" onClick={() => setAddUserOpen(false)}>{t('Cancel')}</Button>
                        <Button leftSection={<IconUserPlus size={16} />} onClick={(e) => { addUser(e); }}>{t('Add User')}</Button>
                    </Group>
                </Stack>
            </Modal>
            <Modal opened={showDeleteUser} onClose={() => setShowDeleteUser(false)} title={t('Are you sure?')}>
                <Text mb="md">{t('Delete {{username}}? This can\'t be undone.', { username })}</Text>
                <Group justify="flex-end">
                    <Button variant="default" onClick={() => setShowDeleteUser(false)}>{t('Cancel')}</Button>
                    <Button
                      color="red"
                      onClick={() => {
                        deleteUser();
                        setShowDeleteUser(false);
                    }}
                    >{t('Delete')}</Button>
                </Group>
            </Modal>
            <Modal
              opened={tempPasswordInfo !== null}
              onClose={() => setTempPasswordInfo(null)}
              title={`Temporary password for ${tempPasswordInfo?.username}`}
            >
                <Text size="sm" c="dimmed" mb="md">
                    {t('Give this to the user directly. It only works once — they\'ll be forced to set their own password immediately after logging in.')}
                </Text>
                <Group justify="center" gap="xs">
                    <Text size="xl" fw={700} ff="monospace">{tempPasswordInfo?.password}</Text>
                    <CopyButton value={tempPasswordInfo?.password ?? ''}>
                        {({ copied, copy }) => (
                            <Tooltip label={copied ? t('Copied') : t('Copy')}>
                                <ActionIcon variant="subtle" onClick={copy}>
                                    {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
                                </ActionIcon>
                            </Tooltip>
                        )}
                    </CopyButton>
                </Group>
            </Modal>
            <Modal
              opened={showSendFile}
              onClose={() => { setShowSendFile(false); setSendFileFile(null); }}
              title={`${t('Send File to')} ${sendFileUsername}`}
            >
                <Text size="sm" c="dimmed" mb="md">
                    {t('The file will be pushed to every TAK device this user is signed into.')}
                </Text>
                <Group justify="space-between">
                    <FileButton onChange={setSendFileFile}>
                        {(props) => <Button variant="light" {...props}>{sendFileFile ? sendFileFile.name : t('Choose File')}</Button>}
                    </FileButton>
                    <Button
                        disabled={!sendFileFile}
                        loading={sendingFile}
                        rightSection={<IconFileUpload size={16} />}
                        onClick={() => { sendFileToUser(); }}
                    >{t('Send')}</Button>
                </Group>
            </Modal>
            <Modal
              opened={showJoinQr}
              onClose={() => setShowJoinQr(false)}
              title={`${t('Join QR Code for')} ${joinQrUsername}`}
            >
                <Text size="sm" c="dimmed" mb="md">
                    {t('Scan this in ATAK or WinTAK to pre-fill the server address and username — the user still enters their own password to complete enrollment.')}
                </Text>
                <Center>
                    <Paper p="md" shadow="xl" withBorder bg="white">
                        <QRCode value={buildJoinQrValue(joinQrUsername)} size={280} quietZone={10} eyeRadius={50} ecLevel="L" qrStyle="dots" />
                    </Paper>
                </Center>
            </Modal>
        </>
    );
}
