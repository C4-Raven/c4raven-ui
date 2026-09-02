import {
    ActionIcon,
    Button,
    Center, Grid,
    Group,
    Modal, MultiSelect,
    Paper,
    PasswordInput,
    Select,
    Switch,
    TableData,
    TextInput, Title, Tooltip,
    ComboboxItem,
    CopyButton,
    Text,
    FileButton,
} from '@mantine/core';
import React, { useEffect, useState } from 'react';
import {
    IconCheck,
    IconCopy,
    IconFileUpload,
    IconKey,
    IconPassword,
    IconShare,
    IconUserCog,
    IconUserMinus,
    IconUserPlus,
    IconUsersMinus,
    IconX
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import axios from '../axios_config';
import { apiRoutes } from '../apiRoutes';
import {t} from "i18next";
import {Link} from "react-router";
import { DataTable, type DataTableSortStatus } from 'mantine-datatable';
import UserVisibilityDiagram from '../components/UserVisibilityDiagram';

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
    const [showVisibilityDiagram, setShowVisibilityDiagram] = useState(false);
    const [showSendFile, setShowSendFile] = useState(false);
    const [sendFileUsername, setSendFileUsername] = useState('');
    const [sendFileFile, setSendFileFile] = useState<File | null>(null);
    const [sendingFile, setSendingFile] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirm_password, setConfirmPassword] = useState('');
    const [role, setRole] = useState('');
    const [allGroups, setAllGroups] = useState<ComboboxItem[]>([])
    const [groups, setGroups] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [memberships, setMemberships] = useState<TableData>({
        caption: '',
        head: [t('Group Name'), t('Direction'), t('Active')],
        body: [],
    });

    function getUsers() {
        setLoading(true);
        axios.get(apiRoutes.users, {
            params: {
                page: activePage,
                per_page: pageSize,
                sort_by: sortStatus.columnAccessor,
                sort_direction: sortStatus.direction,
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

    useEffect(() => { setPage(1); getUsers(); }, [pageSize]);
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

                r.data.results.map((row: any) => {
                    const active_switch = <Tooltip refProp="rootRef" label={t("This membership can be activated or deactivated from the user's EUD")}>
                        <Switch
                            checked={row.active}
                        />
                    </Tooltip>

                    const delete_button = <Button
                        color="red"
                        onClick={() => {removeUserFromGroup(user_name, row.group_name, row.direction);}}
                        key={`${row.group_name}_remove`}
                        rightSection={<IconUsersMinus size={14} />}
                    >Remove</Button>;

                    tableData.body?.push([row.group_name, row.direction, active_switch, delete_button]);
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
            <Group mb="md">
                <Button onClick={() => { setAddUserOpen(true); }} leftSection={<IconUserPlus size={14} />}>{t('Add User')}</Button>
                <Button onClick={() => { setShowVisibilityDiagram(true); }} variant="light" leftSection={<IconShare size={14} />}>{t('User Visibility Diagram')}</Button>
            </Group>
            <DataTable
                withTableBorder
                borderRadius="md"
                shadow="sm"
                striped
                highlightOnHover
                horizontalSpacing="xs"
                scrollAreaProps={{ type: 'auto', offsetScrollbars: true }}
                records={users}
                columns={[
                    {
                        accessor: 'username',
                        title: t('Username'),
                        sortable: true,
                        render: (row) => <Link to={`/profile/${row.username}`}>{row.username}</Link>,
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
                        accessor: 'password_actions',
                        title: t('Password'),
                        render: (row) => (
                            <Group gap="xs" wrap="nowrap">
                                <Tooltip label={t('Force this user to set a new password on next login')}>
                                    <ActionIcon
                                        variant="subtle"
                                        disabled={isProtectedUser(row.username)}
                                        onClick={() => forcePasswordReset(row.username)}
                                    >
                                        <IconPassword size={18} />
                                    </ActionIcon>
                                </Tooltip>
                                <Tooltip label={t('Issue a temporary password (for a user who forgot theirs)')}>
                                    <ActionIcon
                                        variant="subtle"
                                        disabled={isProtectedUser(row.username)}
                                        onClick={() => issueTempPassword(row.username)}
                                    >
                                        <IconKey size={18} />
                                    </ActionIcon>
                                </Tooltip>
                            </Group>
                        ),
                    },
                    {
                        accessor: 'manage_groups',
                        title: '',
                        render: (row) => (
                            <Button
                                rightSection={<IconUserCog />}
                                disabled={isProtectedUser(row.username)}
                                onClick={() => {
                                    setShowManageGroups(true);
                                    getAllGroups();
                                    getMemberships(row.username);
                                    setUsername(row.username);
                                }}
                            >Manage Groups</Button>
                        ),
                    },
                    {
                        accessor: 'send_file',
                        title: '',
                        render: (row) => (
                            <Tooltip label={t('Send this user a file — it will be pushed to their TAK device(s)')}>
                                <Button
                                    variant="light"
                                    rightSection={<IconFileUpload size={16} />}
                                    onClick={() => {
                                        setSendFileUsername(row.username);
                                        setSendFileFile(null);
                                        setShowSendFile(true);
                                    }}
                                >{t('Send File')}</Button>
                            </Tooltip>
                        ),
                    },
                    {
                        accessor: 'delete_user',
                        title: '',
                        render: (row) => (
                            <Button
                                color='red'
                                disabled={row.username === localStorage.getItem('username') || isProtectedUser(row.username)}
                                rightSection={<IconUserMinus />}
                                onClick={() => {
                                    setUsername(row.username);
                                    setShowDeleteUser(true);
                                }}
                            >Delete User</Button>
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
            <Modal size="lg" opened={showManageGroups} onClose={() => setShowManageGroups(false)} title={`Manage Groups for ${username}`}>
                <Paper p="md" mb="md" className="raven-surface raven-surface--tile">
                    <Grid align="flex-end" justify="space-between">
                        <Grid.Col span={10}>
                            <Title order={6} mb="md">Direction: IN</Title>
                            <MultiSelect
                                placeholder="Search"
                                searchable
                                clearable
                                nothingFoundMessage="Nothing found..."
                                label="Select Groups"
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
                            <Title order={6} mb="md">{t("Direction")}: OUT</Title>
                            <MultiSelect
                                placeholder={t("Search")}
                                searchable
                                clearable
                                nothingFoundMessage={t("Nothing found...")}
                                label="Select Groups"
                                onChange={(value) => {setGroups(value)}}
                                data={allGroups} />
                        </Grid.Col>
                        <Grid.Col span={2}>
                            <Button onClick={() => addUserToGroups("OUT")}>Add</Button>
                        </Grid.Col>
                    </Grid>
                </Paper>
                <Title order={4} mb="md">{t("Memberships")}</Title>
                <DataTable
                    withTableBorder
                    borderRadius="md"
                    striped
                    highlightOnHover
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
                <TextInput required label="Username" placeholder="Username" onChange={e => { setUsername(e.target.value); }} />
                <PasswordInput
                  label="Password"
                  placeholder="Password"
                  required
                  mt="md"
                  mb="md"
                  onChange={(e) => setPassword(e.target.value)}
                  value={password}
                />
                <PasswordInput
                  label="Confirm Password"
                  placeholder="Confirm Password"
                  required
                  mt="md"
                  mb="md"
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  value={confirm_password}
                />
                <Select
                  label="Role"
                  placeholder="Role"
                  data={['user', 'administrator']}
                  mb="md"
                  onChange={(_value, option) => { setRole(option.value); }}
                />
                <Button onClick={(e) => { addUser(e); }}>Add User</Button>
            </Modal>
            <Modal opened={showDeleteUser} onClose={() => setShowDeleteUser(false)} title={`Are you sure you want to delete ${username}?`}>
                <Center>
                    <Button
                      mr="md"
                      onClick={() => {
                        deleteUser();
                        setShowDeleteUser(false);
                    }}
                    >Yes
                    </Button>
                    <Button onClick={() => setShowDeleteUser(false)}>No</Button>
                </Center>
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
              size={1014}
              opened={showVisibilityDiagram}
              onClose={() => setShowVisibilityDiagram(false)}
              title={t('User Visibility Diagram')}
            >
                {showVisibilityDiagram && <UserVisibilityDiagram />}
            </Modal>
        </>
    );
}
