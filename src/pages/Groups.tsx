import {
    ActionIcon, Alert, Avatar, Badge, Button, Checkbox, ComboboxItem, Group as MantineGroup, Modal, MultiSelect,
    NumberInput, Paper, Popover, SegmentedControl, Select, Stack, Switch, Text, TextInput, Title, Tooltip,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, differenceInHours, format, isValid, parseISO } from 'date-fns';
import axios from '@/axios_config';
import { apiRoutes } from '@/apiRoutes.tsx';
import {
    IconAdjustments, IconCalendarEvent, IconCirclePlus, IconClockHour4, IconLock, IconPlus, IconTrash,
    IconUserCog, IconUsersPlus, IconX,
} from '@tabler/icons-react';
import { DataTable, type DataTableSortStatus } from 'mantine-datatable';
import UserVisibilityDiagram from '../components/UserVisibilityDiagram';

type Access = 'both' | 'IN' | 'OUT';

// Group policy endpoints (kept here rather than in apiRoutes, which only this page uses)
const GROUP_POLICY_ROUTE = '/api/groups/policy';
const GROUP_POLICY_APPLY_ROUTE = '/api/groups/policy/apply';

export interface Group {
    name: string;
    created: string;
    type: string;
    bitpos: number;
    description: string;
    default_access: Access;
    auto_join: boolean;
    default_membership_days: number | null;
    locked: boolean;
    member_count: number;
}

// A group's raw membership is one row per (user, direction) -- IN lets the
// user send to the group, OUT lets them receive from it. The Members list
// collapses that to one row per person with a single access setting, so a
// member can be made send-only or receive-only right here.
interface MemberRow {
    username: string;
    directions: string[];
    expiresAt: Date | null;
}

interface GroupForm {
    name: string;
    description: string;
    default_access: Access;
    auto_join: boolean;
    default_membership_days: number | string;
    locked: boolean;
    applyToExisting: boolean;
}

const EMPTY_FORM: GroupForm = {
    name: '',
    description: '',
    default_access: 'both',
    auto_join: false,
    default_membership_days: '',
    locked: false,
    applyToExisting: false,
};

// Sent as the direction when adding/removing; the API accepts BOTH too.
const ACCESS_PARAM: Record<Access, string> = { both: 'BOTH', IN: 'IN', OUT: 'OUT' };
const ACCESS_COLOR: Record<Access, string> = { both: 'gray', IN: 'grape', OUT: 'cyan' };

function accessOf(directions: string[]): Access {
    const send = directions.includes('IN');
    const receive = directions.includes('OUT');
    if (send && receive) { return 'both'; }
    return send ? 'IN' : 'OUT';
}

function initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
}

function parseServerDate(value: string | null | undefined): Date | null {
    if (!value) { return null; }
    const d = parseISO(value);
    return isValid(d) ? d : null;
}

// Mantine dates v9 hands back "YYYY-MM-DD HH:mm:ss" in local time.
function toPicker(d: Date | null): string | null {
    return d ? format(d, 'yyyy-MM-dd HH:mm:ss') : null;
}

function fromPicker(v: string | null): Date | null {
    if (!v) { return null; }
    const d = parseISO(v.replace(' ', 'T'));
    return isValid(d) ? d : null;
}

function defaultExpiry(group: Group | null): Date | null {
    return group?.default_membership_days ? addDays(new Date(), group.default_membership_days) : null;
}

function groupMembersByUser(raw: { username: string; direction: string; expires_at?: string | null }[]): MemberRow[] {
    const byUser = new Map<string, MemberRow>();
    raw.forEach((row) => {
        let member = byUser.get(row.username);
        if (!member) {
            member = { username: row.username, directions: [], expiresAt: null };
            byUser.set(row.username, member);
        }
        if (!member.directions.includes(row.direction)) { member.directions.push(row.direction); }
        const expires = parseServerDate(row.expires_at);
        if (expires && (!member.expiresAt || expires < member.expiresAt)) { member.expiresAt = expires; }
    });
    return Array.from(byUser.values()).sort((a, b) => a.username.localeCompare(b.username));
}

function errorMessage(err: any): string | undefined {
    return err?.response?.data?.error ?? err?.message;
}

// Wraps a control that's disabled because the group is locked, so the
// tooltip still shows (disabled elements don't fire mouse events).
function LockedTip({ locked, label, children }: { locked: boolean; label: string; children: React.ReactNode }) {
    if (!locked) { return <>{children}</>; }
    return (
        <Tooltip label={label} withinPortal>
            <span style={{ display: 'inline-flex' }}>{children}</span>
        </Tooltip>
    );
}

export default function Groups() {
    const { t } = useTranslation();
    const [activePage, setPage] = useState(1);
    const [totalRecords, setTotalRecords] = useState(0);
    const [loading, setLoading] = useState(false);
    const [pageSize, setPageSize] = useState(10);
    const [sortStatus, setSortStatus] = useState<DataTableSortStatus<Group>>({
        columnAccessor: 'name',
        direction: 'asc',
    });
    const requestIdRef = useRef(0);
    const [groups, setGroups] = useState<Group[]>([]);

    const [groupToDelete, setGroupToDelete] = useState('');
    const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);

    // Create (editing === null) / edit group modal
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Group | null>(null);
    const [form, setForm] = useState<GroupForm>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [applying, setApplying] = useState(false);

    // Manage members modal
    const [membersOpen, setMembersOpen] = useState(false);
    const [group, setGroup] = useState<Group | null>(null);
    const [memberRows, setMemberRows] = useState<MemberRow[]>([]);
    const [busyMember, setBusyMember] = useState<string | null>(null);
    const [addMemberUsers, setAddMemberUsers] = useState<string[]>([]);
    const [addMemberAccess, setAddMemberAccess] = useState<Access>('both');
    const [addMemberExpiry, setAddMemberExpiry] = useState<string | null>(null);
    const [allUsers, setAllUsers] = useState<ComboboxItem[]>([]);
    const [userFilters, setUserFilters] = useState<{ id: number; name: string; usernames: string[] }[]>([]);
    const [addMemberFilterId, setAddMemberFilterId] = useState<string | null>(null);
    const [expiryEditing, setExpiryEditing] = useState<string | null>(null);
    const [expiryDraft, setExpiryDraft] = useState<string | null>(null);

    const groupName = group?.name ?? '';
    // Stable between renders so the diagram only re-scopes when membership changes
    const memberKey = memberRows.map((m) => m.username).join('\n');
    const memberUsernames = useMemo(() => (memberKey ? memberKey.split('\n') : []), [memberKey]);
    const locked = !!group?.locked;
    const lockedLabel = t('This group is locked. Unlock it in its policies to change members.');

    const accessOptions = [
        { value: 'both', label: t('Send & receive') },
        { value: 'IN', label: t('Send only') },
        { value: 'OUT', label: t('Receive only') },
    ];
    const accessLabel: Record<Access, string> = {
        both: t('Send & receive'),
        IN: t('Send only'),
        OUT: t('Receive only'),
    };

    function showError(title: string, err: any) {
        console.log(err);
        notifications.show({ title, message: errorMessage(err), icon: <IconX />, color: 'red' });
    }

    function getGroups(): Promise<Group[]> {
        const requestId = ++requestIdRef.current;
        setLoading(true);
        return axios.get(apiRoutes.groups, {
            params: {
                page: activePage,
                per_page: pageSize,
                sort_by: sortStatus.columnAccessor,
                sort_direction: sortStatus.direction,
            },
        }).then((r) => {
            if (requestId !== requestIdRef.current) { return []; }
            setLoading(false);
            const rows: Group[] = r.data.results.map((row: any) => ({
                name: row.name,
                created: row.created,
                type: row.type,
                bitpos: parseInt(row.bitpos, 2),
                description: row.description,
                default_access: (row.default_access ?? 'both') as Access,
                auto_join: !!row.auto_join,
                default_membership_days: row.default_membership_days ?? null,
                locked: !!row.locked,
                member_count: row.member_count ?? 0,
            }));
            setPage(r.data.current_page);
            setTotalRecords(r.data.total);
            setGroups(rows);
            return rows;
        }).catch((err) => {
            if (requestId === requestIdRef.current) { setLoading(false); }
            showError(t('Failed to get groups'), err);
            return [];
        });
    }

    // Keeps the open members modal in step with the table after a policy change.
    function refreshGroups() {
        getGroups().then((rows) => {
            setGroup((current) => (current ? rows.find((g) => g.name === current.name) ?? current : current));
        });
    }

    function openCreate() {
        setEditing(null);
        setForm(EMPTY_FORM);
        setFormOpen(true);
    }

    function openEdit(row: Group) {
        setEditing(row);
        setForm({
            name: row.name,
            description: row.description ?? '',
            default_access: row.default_access,
            auto_join: row.auto_join,
            default_membership_days: row.default_membership_days ?? '',
            locked: row.locked,
            applyToExisting: false,
        });
        setFormOpen(true);
    }

    function policyPayload() {
        return {
            description: form.description,
            default_access: form.default_access,
            auto_join: form.auto_join,
            default_membership_days: typeof form.default_membership_days === 'number' ? form.default_membership_days : null,
            locked: form.locked,
        };
    }

    function applyToExisting(name: string) {
        return axios.post(GROUP_POLICY_APPLY_ROUTE, { group_name: name }).then((r) => {
            const added: string[] = r.data.added ?? [];
            notifications.show({
                title: t('Existing users added'),
                message: added.length === 0
                    ? t('Everyone is already in {{group}}', { group: name })
                    : added.length === 1
                        ? t('Added {{username}} to {{group}}', { username: added[0], group: name })
                        : t('Added {{count}} users to {{group}}', { count: added.length, group: name }),
                color: 'green',
            });
        });
    }

    function saveGroup() {
        if (!editing && !form.name.trim()) { return; }
        setSaving(true);
        const request = editing
            ? axios.patch(GROUP_POLICY_ROUTE, { group_name: editing.name, ...policyPayload() })
            : axios.post(apiRoutes.groups, { name: form.name.trim(), ...policyPayload() })
                .then(() => (form.auto_join && form.applyToExisting && !form.locked
                    ? applyToExisting(form.name.trim()) : undefined));
        request.then(() => {
            setFormOpen(false);
            refreshGroups();
        }).catch((err) => {
            showError(editing ? t('Failed to save group') : t('Failed to create group'), err);
        }).finally(() => setSaving(false));
    }

    function applyNow() {
        if (!editing) { return; }
        setApplying(true);
        applyToExisting(editing.name)
            .then(() => refreshGroups())
            .catch((err) => showError(t('Failed to add existing users'), err))
            .finally(() => setApplying(false));
    }

    function deleteGroup(name: string) {
        axios.delete(apiRoutes.groups, { params: { group_name: name } }).then(() => {
            getGroups();
        }).catch((err) => showError(t('Failed to delete {{group}}', { group: name }), err));
    }

    function getGroupMembers(name: string) {
        axios.get(apiRoutes.groupMembers, { params: { name } }).then((r) => {
            setMemberRows(groupMembersByUser(r.data));
        }).catch((err) => showError(t('Failed to get group members'), err));
    }

    function getUserFilters() {
        axios.get(apiRoutes.userFilters).then((r) => setUserFilters(r.data)).catch((err) => console.log(err));
    }

    function getAllUsers() {
        axios.get(apiRoutes.allUsers).then((r) => {
            setAllUsers(r.data.map((row: any) => row.username));
        }).catch((err) => showError(t('Failed to get user list'), err));
    }

    function openMembers(row: Group) {
        setGroup(row);
        setMemberRows([]);
        setAddMemberUsers([]);
        setAddMemberFilterId(null);
        setAddMemberAccess(row.default_access);
        setAddMemberExpiry(toPicker(defaultExpiry(row)));
        getGroupMembers(row.name);
        getAllUsers();
        getUserFilters();
        setMembersOpen(true);
    }

    function closeMembers() {
        setMembersOpen(false);
        // Member counts in the table
        getGroups();
    }

    // Adds each selected user with the chosen access -- both ways (the usual
    // case), send-only (IN) or receive-only (OUT) -- and expiry.
    function addMemberToGroup() {
        if (addMemberUsers.length === 0 || !group) { return; }
        const expires = fromPicker(addMemberExpiry);
        axios.put(apiRoutes.groups, {
            users: addMemberUsers,
            group_name: group.name,
            direction: ACCESS_PARAM[addMemberAccess],
            expires_at: expires ? expires.toISOString() : null,
        }).then(() => {
            getGroupMembers(group.name);
            setAddMemberUsers([]);
        }).catch((err) => showError(t('Failed to add member'), err));
    }

    function updateMember(row: MemberRow, change: { access?: Access; expires_at?: string | null }, failTitle: string) {
        setBusyMember(row.username);
        return axios.patch(apiRoutes.groupMembers, { username: row.username, group_name: groupName, ...change })
            .then(() => true)
            .catch((err) => { showError(failTitle, err); return false; })
            .finally(() => {
                setBusyMember(null);
                getGroupMembers(groupName);
            });
    }

    function setMemberAccess(row: MemberRow, access: Access) {
        if (access === accessOf(row.directions)) { return; }
        // Show the new choice straight away; the reload after the request
        // puts it back if the server refused.
        setMemberRows((rows) => rows.map((r) => (r.username === row.username
            ? { ...r, directions: access === 'both' ? ['IN', 'OUT'] : [access] } : r)));
        updateMember(row, { access }, t('Failed to change member access'));
    }

    function openExpiryEditor(row: MemberRow) {
        setExpiryDraft(toPicker(row.expiresAt ?? defaultExpiry(group) ?? addDays(new Date(), 7)));
        setExpiryEditing(row.username);
    }

    function saveExpiry(row: MemberRow, value: Date | null) {
        updateMember(row, { expires_at: value ? value.toISOString() : null }, t('Failed to change expiry'))
            .then((ok) => { if (ok) { setExpiryEditing(null); } });
    }

    function removeMemberCompletely(row: MemberRow) {
        axios.delete(apiRoutes.groupMembers, {
            params: { username: row.username, group_name: groupName, direction: 'BOTH' },
        }).then(() => getGroupMembers(groupName))
            .catch((err) => showError(t('Failed to remove member'), err));
    }

    useEffect(() => {
        setPage(1);
    }, [pageSize]);

    useEffect(() => {
        getGroups();
    }, [activePage, pageSize, sortStatus]);

    const activeAddMemberFilter = userFilters.find((f) => String(f.id) === addMemberFilterId);
    const addableUsers = allUsers.filter((u) => {
        const username = typeof u === 'string' ? u : u.value;
        if (memberRows.some((m) => m.username === username)) { return false; }
        if (activeAddMemberFilter && !activeAddMemberFilter.usernames.includes(username)) { return false; }
        return true;
    });
    const addExpiryDate = fromPicker(addMemberExpiry);
    const addExpiryInPast = !!addExpiryDate && addExpiryDate.getTime() <= Date.now();
    const draftDate = fromPicker(expiryDraft);
    const draftInPast = !!draftDate && draftDate.getTime() <= Date.now();

    function policyBadges(row: Group) {
        return (
            <MantineGroup gap={6} wrap="wrap">
                <Badge variant="light" color={ACCESS_COLOR[row.default_access]} tt="none">
                    {accessLabel[row.default_access]}
                </Badge>
                {row.auto_join && <Badge variant="light" color="green" tt="none">{t('Auto-join')}</Badge>}
                {row.default_membership_days && (
                    <Badge variant="light" color="orange" tt="none" leftSection={<IconClockHour4 size={12} />}>
                        {t('Expires after {{count}} days', { count: row.default_membership_days })}
                    </Badge>
                )}
                {row.locked && (
                    <Badge variant="light" color="red" tt="none" leftSection={<IconLock size={12} />}>{t('Locked')}</Badge>
                )}
            </MantineGroup>
        );
    }

    function expiryChip(row: MemberRow) {
        const expires = row.expiresAt;
        const hoursLeft = expires ? differenceInHours(expires, new Date()) : null;
        const color = expires === null ? 'gray' : hoursLeft !== null && hoursLeft < 24 ? 'red' : 'orange';
        const label = expires
            ? t('Expires {{when}}', { when: format(expires, 'd MMM yyyy, HH:mm') })
            : t('No expiry');
        return (
            <Popover
                opened={expiryEditing === row.username}
                onChange={(opened) => { if (!opened) { setExpiryEditing(null); } }}
                position="bottom-end"
                withinPortal
                trapFocus
            >
                <Popover.Target>
                    <span style={{ display: 'inline-flex' }}>
                        <LockedTip locked={locked} label={lockedLabel}>
                            <Badge
                                component="button"
                                type="button"
                                variant={expires ? 'light' : 'outline'}
                                color={color}
                                tt="none"
                                size="lg"
                                leftSection={<IconClockHour4 size={12} />}
                                disabled={locked}
                                aria-label={t('Set expiry for {{username}}', { username: row.username })}
                                style={{ cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.6 : 1 }}
                                onClick={() => {
                                    if (locked) { return; }
                                    if (expiryEditing === row.username) { setExpiryEditing(null); } else { openExpiryEditor(row); }
                                }}
                            >
                                {label}
                            </Badge>
                        </LockedTip>
                    </span>
                </Popover.Target>
                <Popover.Dropdown>
                    <Stack gap="xs" w={260}>
                        <DateTimePicker
                            label={t('Membership expires')}
                            description={t('Your local time')}
                            leftSection={<IconCalendarEvent size={16} />}
                            value={expiryDraft}
                            onChange={setExpiryDraft}
                            minDate={new Date()}
                            valueFormat="ddd D MMM YYYY, HH:mm"
                            popoverProps={{ withinPortal: false }}
                            error={draftInPast ? t('Pick a time in the future') : undefined}
                        />
                        <MantineGroup justify="space-between" gap="xs">
                            <Button
                                size="xs"
                                variant="subtle"
                                color="red"
                                disabled={!row.expiresAt}
                                loading={busyMember === row.username && !draftDate}
                                onClick={() => saveExpiry(row, null)}
                            >
                                {t('Remove expiry')}
                            </Button>
                            <Button
                                size="xs"
                                disabled={!draftDate || draftInPast}
                                loading={busyMember === row.username}
                                onClick={() => saveExpiry(row, draftDate)}
                            >
                                {t('Save')}
                            </Button>
                        </MantineGroup>
                    </Stack>
                </Popover.Dropdown>
            </Popover>
        );
    }

    return (
        <Stack gap="lg">
            <MantineGroup justify="space-between" align="flex-end" wrap="wrap" gap="sm">
                <div>
                    <Title order={2}>{t('Groups')}</Title>
                    <Text size="sm" c="dimmed">
                        {t('Who can send to and receive from each group, and the policies new members get')}
                    </Text>
                </div>
                <Button className="raven-cta" leftSection={<IconCirclePlus size={16} />} onClick={openCreate}>
                    {t('Add Group')}
                </Button>
            </MantineGroup>

            <DataTable
                withTableBorder
                borderRadius="md"
                highlightOnHover
                records={groups}
                idAccessor="name"
                columns={[
                    {
                        accessor: 'name',
                        title: t('Name'),
                        sortable: true,
                        render: (row: Group) => (
                            <MantineGroup gap={6} wrap="nowrap">
                                {row.locked && <IconLock size={14} aria-label={t('Locked')} />}
                                <Text size="sm" fw={600}>{row.name}</Text>
                            </MantineGroup>
                        ),
                    },
                    { accessor: 'description', title: t('Description'), sortable: true },
                    {
                        accessor: 'member_count',
                        title: t('Members'),
                        textAlign: 'right',
                        render: (row: Group) => row.member_count,
                    },
                    {
                        accessor: 'policies',
                        title: t('Policies'),
                        render: (row: Group) => policyBadges(row),
                    },
                    {
                        accessor: 'created',
                        title: t('Created'),
                        sortable: true,
                        render: (row: Group) => (row.created ? new Date(row.created).toLocaleDateString() : '-'),
                    },
                    {
                        accessor: 'actions',
                        title: '',
                        textAlign: 'right',
                        render: (row: Group) => {
                            const undeletable = row.name === '__ANON__' || row.locked;
                            return (
                                <MantineGroup gap={8} justify="flex-end" wrap="nowrap">
                                    <Tooltip label={t('Manage members')}>
                                        <ActionIcon variant="light" aria-label={t('Manage members')} onClick={() => openMembers(row)}>
                                            <IconUserCog size={16} />
                                        </ActionIcon>
                                    </Tooltip>
                                    <Tooltip label={t('Edit group & policies')}>
                                        <ActionIcon variant="light" aria-label={t('Edit group & policies')} onClick={() => openEdit(row)}>
                                            <IconAdjustments size={16} />
                                        </ActionIcon>
                                    </Tooltip>
                                    <Tooltip
                                        label={row.name === '__ANON__'
                                            ? t("The default group can't be deleted")
                                            : row.locked ? t('Unlock this group before deleting it') : t('Delete group')}
                                    >
                                        <span style={{ display: 'inline-flex' }}>
                                            <ActionIcon
                                                color="red"
                                                variant="light"
                                                aria-label={t('Delete group')}
                                                disabled={undeletable}
                                                onClick={() => {
                                                    setGroupToDelete(row.name);
                                                    setDeleteGroupOpen(true);
                                                }}
                                            >
                                                <IconTrash size={16} />
                                            </ActionIcon>
                                        </span>
                                    </Tooltip>
                                </MantineGroup>
                            );
                        },
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
                minHeight={groups.length === 0 ? 180 : undefined}
                noRecordsText={t('No groups yet')}
            />

            {/* Create / edit group */}
            <Modal
                opened={formOpen}
                onClose={() => setFormOpen(false)}
                title={editing ? t('Edit {{group}}', { group: editing.name }) : t('Add Group')}
                size="lg"
            >
                <Stack gap="md">
                    <TextInput
                        required
                        label={t('Name')}
                        value={form.name}
                        disabled={!!editing}
                        onChange={(e) => { const name = e.currentTarget.value; setForm((f) => ({ ...f, name })); }}
                    />
                    <TextInput
                        label={t('Description')}
                        value={form.description}
                        onChange={(e) => { const description = e.currentTarget.value; setForm((f) => ({ ...f, description })); }}
                    />

                    <Paper p="md" className="raven-surface raven-surface--tile">
                        <Title order={5} mb="sm">{t('Policies')}</Title>
                        <Stack gap="md">
                            <div>
                                <Text size="sm" fw={500} mb={4}>{t('Default access for new members')}</Text>
                                <SegmentedControl
                                    fullWidth
                                    value={form.default_access}
                                    onChange={(v) => setForm((f) => ({ ...f, default_access: v as Access }))}
                                    data={accessOptions}
                                />
                                <Text size="xs" c="dimmed" mt={4}>
                                    {t('Preselected when adding members, and used for auto-join.')}
                                </Text>
                            </div>

                            <div>
                                <Switch
                                    label={t('Auto-join new users')}
                                    description={t('New user accounts are added to this group with the default access.')}
                                    checked={form.auto_join}
                                    onChange={(e) => { const auto_join = e.currentTarget.checked; setForm((f) => ({ ...f, auto_join })); }}
                                />
                                {editing ? (
                                    <LockedTip locked={editing.locked} label={lockedLabel}>
                                        <Button
                                            mt="xs"
                                            ml={54}
                                            size="xs"
                                            variant="light"
                                            leftSection={<IconUsersPlus size={14} />}
                                            loading={applying}
                                            disabled={editing.locked}
                                            onClick={applyNow}
                                        >
                                            {t('Add all current users now')}
                                        </Button>
                                    </LockedTip>
                                ) : form.auto_join && (
                                    <Checkbox
                                        mt="xs"
                                        ml={54}
                                        size="xs"
                                        label={t('Also add all current users when the group is created')}
                                        checked={form.applyToExisting}
                                        onChange={(e) => { const applyToExisting = e.currentTarget.checked; setForm((f) => ({ ...f, applyToExisting })); }}
                                    />
                                )}
                            </div>

                            <NumberInput
                                label={t('Default membership duration')}
                                description={t('New memberships expire after this many days. Leave empty for no expiry.')}
                                placeholder={t('No expiry')}
                                min={1}
                                max={3650}
                                allowDecimal={false}
                                allowNegative={false}
                                rightSection={<Text size="xs" c="dimmed" pr={8}>{t('days')}</Text>}
                                rightSectionWidth={48}
                                value={form.default_membership_days}
                                onChange={(v) => setForm((f) => ({ ...f, default_membership_days: v }))}
                                maw={260}
                            />

                            <Switch
                                color="red"
                                label={t('Locked')}
                                description={t("A locked group can't be deleted and its members can't be changed until it's unlocked. Auto-join and expiry still apply.")}
                                checked={form.locked}
                                onChange={(e) => { const isLocked = e.currentTarget.checked; setForm((f) => ({ ...f, locked: isLocked })); }}
                            />
                        </Stack>
                    </Paper>

                    <MantineGroup justify="flex-end" gap="sm">
                        <Button variant="default" onClick={() => setFormOpen(false)}>{t('Cancel')}</Button>
                        <Button loading={saving} disabled={!editing && !form.name.trim()} onClick={saveGroup}>
                            {editing ? t('Save') : t('Add Group')}
                        </Button>
                    </MantineGroup>
                </Stack>
            </Modal>

            {/* Members */}
            <Modal size={1014} opened={membersOpen} onClose={closeMembers} title={t('Manage {{group}} Members', { group: groupName })}>
                {group && (
                    <MantineGroup gap={6} mb="md">
                        {policyBadges(group)}
                    </MantineGroup>
                )}
                {locked && (
                    <Alert color="red" variant="light" icon={<IconLock size={16} />} mb="md">
                        {lockedLabel}
                    </Alert>
                )}
                <Paper p="md" mb="lg" className="raven-surface raven-surface--tile">
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                        {userFilters.length > 0 && (
                            <Select
                                w={180}
                                label={t('Narrow to filter')}
                                placeholder={t('All users')}
                                clearable
                                value={addMemberFilterId}
                                onChange={setAddMemberFilterId}
                                data={userFilters.map((f) => ({ value: String(f.id), label: f.name }))}
                                disabled={locked}
                            />
                        )}
                        <MultiSelect
                            style={{ flex: '1 1 220px' }}
                            placeholder={t('Search users')}
                            searchable
                            clearable
                            nothingFoundMessage={t('Nothing found...')}
                            label={t('Add member')}
                            value={addMemberUsers}
                            onChange={setAddMemberUsers}
                            data={addableUsers}
                            disabled={locked}
                        />
                        <DateTimePicker
                            w={220}
                            label={t('Expires')}
                            placeholder={t('No expiry')}
                            leftSection={<IconCalendarEvent size={16} />}
                            clearable
                            value={addMemberExpiry}
                            onChange={setAddMemberExpiry}
                            minDate={new Date()}
                            valueFormat="D MMM YYYY, HH:mm"
                            popoverProps={{ withinPortal: true }}
                            error={addExpiryInPast ? t('Pick a time in the future') : undefined}
                            disabled={locked}
                        />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 12 }}>
                        <SegmentedControl
                            size="sm"
                            value={addMemberAccess}
                            onChange={(v) => setAddMemberAccess(v as Access)}
                            data={accessOptions}
                            disabled={locked}
                        />
                        <LockedTip locked={locked} label={lockedLabel}>
                            <Button
                                leftSection={<IconPlus size={16} />}
                                onClick={addMemberToGroup}
                                disabled={locked || addMemberUsers.length === 0 || addExpiryInPast}
                            >
                                {t('Add')}
                            </Button>
                        </LockedTip>
                    </div>
                    <Text size="xs" c="dimmed" mt={6}>
                        {t("Send only: the member's data reaches the group but they don't see the group's. Receive only: the opposite. Two-way members see each other both ways, so use these for one-way access.")}
                    </Text>
                </Paper>

                <Title order={5} mb="xs">{t('Members')}</Title>
                <Stack gap="xs" mb="xl">
                    {memberRows.length === 0 ? (
                        <Text size="sm" c="dimmed">{t('No members yet — add some above.')}</Text>
                    ) : memberRows.map((row) => (
                        <Paper
                            key={row.username}
                            p="sm"
                            className="raven-surface raven-surface--tile"
                            style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}
                            data-member={row.username}
                        >
                            <Avatar radius="xl" color="blue">{initials(row.username)}</Avatar>
                            <Text fw={600} style={{ flex: 1, minWidth: 120 }}>{row.username}</Text>
                            {expiryChip(row)}
                            <LockedTip locked={locked} label={lockedLabel}>
                                <SegmentedControl
                                    size="xs"
                                    value={accessOf(row.directions)}
                                    onChange={(v) => setMemberAccess(row, v as Access)}
                                    data={accessOptions}
                                    disabled={locked || busyMember === row.username}
                                    aria-label={t('Access for {{username}}', { username: row.username })}
                                />
                            </LockedTip>
                            <Tooltip label={locked ? lockedLabel : t('Remove from group')}>
                                <span style={{ display: 'inline-flex' }}>
                                    <ActionIcon
                                        color="red"
                                        variant="subtle"
                                        aria-label={t('Remove {{username}} from group', { username: row.username })}
                                        disabled={locked}
                                        onClick={() => removeMemberCompletely(row)}
                                    >
                                        <IconTrash size={16} />
                                    </ActionIcon>
                                </span>
                            </Tooltip>
                        </Paper>
                    ))}
                </Stack>

                <Title order={5} mb={4}>{t('Who Can See Whom')}</Title>
                <Text size="sm" c="dimmed" mb="md">
                    {t('Drag a member to rearrange them, then click one and another to connect or disconnect them.')}
                </Text>
                {membersOpen && (
                    <UserVisibilityDiagram
                        scopeToUsernames={memberUsernames}
                        onChange={() => getGroupMembers(groupName)}
                    />
                )}
            </Modal>

            <Modal opened={deleteGroupOpen} onClose={() => setDeleteGroupOpen(false)} title={t('Delete group {{group}}?', { group: groupToDelete })}>
                <Text size="sm" mb="md">
                    {t("Everyone in the group loses access to it straight away. This can't be undone.")}
                </Text>
                <MantineGroup justify="flex-end" gap="sm">
                    <Button variant="default" onClick={() => setDeleteGroupOpen(false)}>{t('Cancel')}</Button>
                    <Button
                        color="red"
                        onClick={() => {
                            deleteGroup(groupToDelete);
                            setDeleteGroupOpen(false);
                        }}
                    >
                        {t('Delete')}
                    </Button>
                </MantineGroup>
            </Modal>
        </Stack>
    );
}
