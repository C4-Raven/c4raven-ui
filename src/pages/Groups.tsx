import {
    ActionIcon, Avatar, Button,
    Center, ComboboxItem, Modal, MultiSelect, Paper,
    Select,
    Stack,
    Table,
    Text, TextInput, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import React, { useEffect, useState } from 'react';
import axios from "axios";
import {apiRoutes} from "@/apiRoutes.tsx";
import {IconCirclePlus, IconPlus, IconTrash, IconUserCog, IconX} from "@tabler/icons-react";
import {t} from "i18next";
import { DataTable, type DataTableSortStatus } from 'mantine-datatable';
import UserVisibilityDiagram from '../components/UserVisibilityDiagram';

export interface Group {
    name: string;
    created: string;
    type: string;
    bitpos: number;
    description: string;
}

// A group's raw membership is one row per (user, direction) -- IN and OUT
// are separate technical grants. The Members list below collapses that back
// to one row per person (added both ways by default), and leaves selective
// one-way connections to the diagram, which is the only place that
// distinction still needs to be exposed.
interface MemberRow {
    username: string;
    directions: string[];
}

function initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
}

function groupMembersByUser(raw: { username: string; direction: string }[]): MemberRow[] {
    const byUser = new Map<string, Set<string>>();
    raw.forEach((row) => {
        if (!byUser.has(row.username)) byUser.set(row.username, new Set());
        byUser.get(row.username)!.add(row.direction);
    });
    return Array.from(byUser.entries()).map(([username, directions]) => ({
        username,
        directions: Array.from(directions),
    }));
}

export default function Groups() {
    const [activePage, setPage] = useState(1);
    const [totalRecords, setTotalRecords] = useState(0);
    const [loading, setLoading] = useState(false);
    const [pageSize, setPageSize] = useState(10);
    const [sortStatus, setSortStatus] = useState<DataTableSortStatus<Group>>({
        columnAccessor: 'name',
        direction: 'asc',
    });
    const [groupToDelete, setGroupToDelete] = useState('');
    const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);
    const [showAddGroup, setShowAddGroup] = useState(false);
    const [showAddUserToGroup, setShowAddUserToGroup] = useState(false);
    const [addMemberUsers, setAddMemberUsers] = useState<string[]>([]);
    const [allUsers, setAllUsers] = useState<ComboboxItem[]>([]);
    const [userFilters, setUserFilters] = useState<{ id: number; name: string; usernames: string[] }[]>([]);
    const [addMemberFilterId, setAddMemberFilterId] = useState<string | null>(null);
    const [group, setGroup] = useState("");
    const [memberUsernames, setMemberUsernames] = useState<string[]>([]);
    const [memberRows, setMemberRows] = useState<MemberRow[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [newGroupProperties, setNewGroupProperties] = useState(
        {   name: '',
            created: '',
            type: '',
            bitpos: 0,
            description: ''
        }
    );

    function get_groups() {
        if (loading) {
            return;
        }
        setLoading(true);
        axios.get(apiRoutes.groups, {
            params: {
                page: activePage,
                per_page: pageSize,
                sort_by: sortStatus.columnAccessor,
                sort_direction: sortStatus.direction,
            }
        })
            .then((r) => {
                setLoading(false);
                if (r.status === 200) {
                    const rows: Group[] = r.data.results.map((row: any) => ({
                        name: row.name,
                        created: row.created,
                        type: row.type,
                        bitpos: parseInt(row.bitpos, 2),
                        description: row.description,
                    }));
                    setPage(r.data.current_page);
                    setTotalRecords(r.data.total);
                    setGroups(rows);
                }
            }).catch((err) => {
                setLoading(false);
                console.log(err);
                notifications.show({
                    title: t('Failed to get groups'),
                    message: err.response.data.error,
                    icon: <IconX />,
                    color: 'red',
                });
            });
    }

    function addGroup() {
        axios.post(apiRoutes.groups, newGroupProperties).then((r) => {
            if (r.status === 200) {
                setShowAddGroup(false);
                get_groups();
            }
        }).catch((err) => {
            console.log(err);
            notifications.show({
                title: t('Failed to create group'),
                message: err.response.data.error,
                icon: <IconX />,
                color: 'red',
            });
        })
    }

    // Adds each selected user both ways (IN and OUT) -- full mutual exchange
    // is what "add someone to a group" means for almost everyone; the
    // diagram below is where a one-way exception gets dialed in afterward.
    function addMemberToGroup() {
        if (addMemberUsers.length === 0) return;
        Promise.all([
            axios.put(apiRoutes.groups, { users: addMemberUsers, group_name: group, direction: "IN" }),
            axios.put(apiRoutes.groups, { users: addMemberUsers, group_name: group, direction: "OUT" }),
        ]).then(() => {
            getGroupMembers(group);
            setAddMemberUsers([]);
        }).catch((err) => {
            console.log(err);
            notifications.show({
                title: t('Failed to add member'),
                message: err.response?.data?.error,
                icon: <IconX />,
                color: 'red',
            })
        });
    }

    function getUserFilters() {
        axios.get(apiRoutes.userFilters).then((r) => {
            setUserFilters(r.data);
        }).catch((err) => {
            console.log(err);
        });
    }

    function getAllUsers() {
        axios.get(apiRoutes.allUsers).then((r) => {
            if (r.status === 200) {
                const all_users: ComboboxItem[] = [];
                r.data.map((row: any) => {
                    all_users.push(row.username);
                });
                setAllUsers(all_users);
            }
        }).catch(err => {
            console.log(err);
            notifications.show({
                title: t('Failed to get user list'),
                message: err.response.data.error,
                icon: <IconX />,
                color: 'red',
            })
        });
    }

    function deleteGroup(group_name: string) {
        axios.delete(apiRoutes.groups, {params: {group_name}}).then((r) => {
            if (r.status === 200) {
                get_groups();
            }
        }).catch(err => {
            console.log(err);
            notifications.show({
                title: `Failed delete ${group_name}`,
                message: err.response.data.error,
                icon: <IconX />,
                color: 'red',
            })
        });
    }

    // Removes a member entirely -- both the IN and OUT grants they
    // currently hold, whichever of those they actually have.
    function removeMemberCompletely(row: MemberRow) {
        Promise.all(
            row.directions.map((direction) =>
                axios.delete(apiRoutes.groupMembers, { params: { username: row.username, group_name: group, direction } })
            )
        ).then(() => {
            getGroupMembers(group);
        }).catch(err => {
            console.log(err);
            notifications.show({
                title: t('Failed to remove member'),
                message: err.response?.data?.error,
                icon: <IconX />,
                color: 'red',
            })
        });
    }

    function getGroupMembers(name: string) {
        axios.get(apiRoutes.groupMembers, {params: {name}}).then((r) => {
            if (r.status === 200) {
                setMemberRows(groupMembersByUser(r.data));
                setMemberUsernames([...new Set<string>(r.data.map((row: any) => row.username))]);
            }
        }).catch(err => {
            console.log(err);
            notifications.show({
                title: t('Failed to get group members'),
                message: err.response.data.error,
                icon: <IconX />,
                color: 'red',
            })
        });
    }

    useEffect(() => {
        setPage(1);
        get_groups();
    }, [pageSize]);

    useEffect(() => {
        get_groups();
    }, [activePage, sortStatus]);

    const activeAddMemberFilter = userFilters.find((f) => String(f.id) === addMemberFilterId);
    const addableUsers = allUsers.filter((u) => {
        const username = typeof u === 'string' ? u : u.value;
        if (memberRows.some((m) => m.username === username)) return false;
        if (activeAddMemberFilter && !activeAddMemberFilter.usernames.includes(username)) return false;
        return true;
    });

    return (
        <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <Button leftSection={<IconCirclePlus size={16} />} onClick={() => setShowAddGroup(true)}>{t("Add Group")}</Button>
            </div>
            <Modal opened={showAddGroup} onClose={() => setShowAddGroup(false)} title={t("Add Group")}>
                <TextInput required label={t("Name")} onChange={e => { newGroupProperties.name = e.target.value; }} mb="md" />
                <TextInput required label={t("Description")} onChange={e => { newGroupProperties.description = e.target.value; }} mb="md" />
                <Button
                    mb="md"
                    onClick={e => {
                        addGroup();
                    }}
                >Add Group
                </Button>
            </Modal>
            <Modal size={1014} opened={showAddUserToGroup} onClose={() => setShowAddUserToGroup(false)} title={t("Manage {{group}} Members", { group })}>
                <Paper p="md" mb="lg" radius="md" className="raven-surface raven-surface--tile">
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                        {userFilters.length > 0 && (
                            <Select
                                w={180}
                                label={t("Narrow to filter")}
                                placeholder={t("All users")}
                                clearable
                                value={addMemberFilterId}
                                onChange={setAddMemberFilterId}
                                data={userFilters.map((f) => ({ value: String(f.id), label: f.name }))}
                            />
                        )}
                        <MultiSelect
                            style={{ flex: 1 }}
                            placeholder={t("Search users")}
                            searchable
                            clearable
                            nothingFoundMessage={t("Nothing found...")}
                            label={t("Add member")}
                            value={addMemberUsers}
                            onChange={setAddMemberUsers}
                            data={addableUsers}
                        />
                        <Button leftSection={<IconPlus size={16} />} onClick={addMemberToGroup} disabled={addMemberUsers.length === 0}>
                            {t("Add")}
                        </Button>
                    </div>
                    <Text size="xs" c="dimmed" mt={6}>
                        {t("Added members exchange data both ways by default — use the diagram below for one-way or fine-grained connections.")}
                    </Text>
                </Paper>

                <Title order={5} mb="xs">{t("Members")}</Title>
                <Stack gap="xs" mb="xl">
                    {memberRows.length === 0 ? (
                        <Text size="sm" c="dimmed">{t("No members yet — add some above.")}</Text>
                    ) : memberRows.map((row) => (
                        <Paper
                            key={row.username}
                            p="sm"
                            radius="md"
                            className="raven-surface raven-surface--tile"
                            style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                        >
                            <Avatar radius="xl" color="blue">{initials(row.username)}</Avatar>
                            <Text fw={600} style={{ flex: 1 }}>{row.username}</Text>
                            <Tooltip label={t("Remove from group")}>
                                <ActionIcon color="red" variant="subtle" onClick={() => removeMemberCompletely(row)}>
                                    <IconTrash size={16} />
                                </ActionIcon>
                            </Tooltip>
                        </Paper>
                    ))}
                </Stack>

                <Title order={5} mb={4}>{t("Who Can See Whom")}</Title>
                <Text size="sm" c="dimmed" mb="md">
                    {t("Drag a member to rearrange them, then click one and another to connect or disconnect them.")}
                </Text>
                {showAddUserToGroup && <UserVisibilityDiagram scopeToUsernames={memberUsernames} onChange={() => getGroupMembers(group)} />}
            </Modal>
            <Modal opened={deleteGroupOpen} onClose={() => setDeleteGroupOpen(false)} title={`Delete Group ${groupToDelete}?`}>
                <Center>
                    <Button
                        mr="md"
                        onClick={() => {
                            deleteGroup(groupToDelete);
                            setDeleteGroupOpen(false);
                        }}
                    >Yes
                    </Button>
                    <Button onClick={() => setDeleteGroupOpen(false)}>{t("No")}</Button>
                </Center>
            </Modal>
            <Table.ScrollContainer minWidth="100%">
                <DataTable
                    withTableBorder
                    borderRadius="md"
                    shadow="sm"
                    striped
                    highlightOnHover
                    records={groups}
                    columns={[
                        { accessor: 'name', title: t('Name'), sortable: true },
                        { accessor: 'description', title: t('Description'), sortable: true },
                        {
                            accessor: 'created',
                            title: t('Created'),
                            sortable: true,
                            render: (row: Group) => row.created ? new Date(row.created).toLocaleDateString() : '-',
                        },
                        {
                            accessor: 'actions',
                            title: '',
                            textAlign: 'right',
                            render: (row: Group) => (
                                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                    <Tooltip label={t("Manage members")}>
                                        <ActionIcon
                                            variant="light"
                                            onClick={() => {
                                                setMemberUsernames([]);
                                                setAddMemberFilterId(null);
                                                getGroupMembers(row.name);
                                                getAllUsers();
                                                getUserFilters();
                                                setGroup(row.name);
                                                setShowAddUserToGroup(true);
                                            }}
                                        >
                                            <IconUserCog size={16} />
                                        </ActionIcon>
                                    </Tooltip>
                                    <Tooltip label={row.name === "__ANON__" ? t("The default group can't be deleted") : t("Delete group")}>
                                        <ActionIcon
                                            color="red"
                                            variant="light"
                                            disabled={row.name === "__ANON__"}
                                            onClick={() => {
                                                setGroupToDelete(row.name);
                                                setDeleteGroupOpen(true);
                                            }}
                                        >
                                            <IconTrash size={16} />
                                        </ActionIcon>
                                    </Tooltip>
                                </div>
                            ),
                        },
                    ]}
                    page={activePage}
                    onPageChange={(p) => setPage(p)}
                    onRecordsPerPageChange={setPageSize}
                    totalRecords={totalRecords}
                    recordsPerPage={pageSize}
                    recordsPerPageOptions={[10, 15, 20, 25, 30, 35, 40, 45, 50]}
                    sortStatus={sortStatus}
                    onSortStatusChange={setSortStatus}
                    fetching={loading}
                    minHeight={180}
                />
            </Table.ScrollContainer>
        </>
    )
}
