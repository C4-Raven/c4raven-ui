/**
 * Catalog of ATAK preference keys an admin can push in a device profile.
 *
 * Every key, value class, default and option value below was checked against the
 * ATAK-CIV source:
 *   - TAK-Product-Center/atak-civ (ATAK 5.x, main @ 9f6893d, Dec 2025) — primary
 *   - deptofdefense/AndroidTacticalAssaultKit-CIV (ATAK 4.x) — older releases
 * Preference definitions live in atak/ATAK/app/src/main/res/xml/*.xml and option
 * lists in res/values/arrays.xml; the `source` field names the exact file.
 *
 * About value classes: Android stores values from text boxes and drop-down lists
 * (EditTextPreference / ListPreference) as Strings, even when they look like
 * numbers. ATAK reads them back with Integer.parseInt(prefs.getString(...))
 * (e.g. comms/ReportingRate.java). Sending them as java.lang.Integer would put
 * an Integer into the store and make ATAK's getString() call fail, so those keys
 * use 'class java.lang.String' here even when the UI shows a number box.
 * Checkboxes are stored as java.lang.Boolean. The .pref import code that applies
 * these is app/preferences/PreferenceControl.java.
 */

export type ValueClass =
    | 'class java.lang.String'
    | 'class java.lang.Boolean'
    | 'class java.lang.Integer'
    | 'class java.lang.Long'
    | 'class java.lang.Float';

export interface SettingOption { value: string; label: string }

export interface SettingDef {
    key: string;            // exact ATAK preference key
    label: string;          // friendly name, e.g. "Team colour"
    description: string;    // one plain-English sentence on what it does on the device
    category: string;       // one of CATEGORIES[].id
    valueClass: ValueClass;
    input: 'text' | 'toggle' | 'select' | 'number' | 'password';
    options?: SettingOption[];  // for select
    min?: number; max?: number; unit?: string;
    placeholder?: string;
    defaultValue?: string;      // ATAK's own default, as a string
    sensitive?: boolean;        // mask in UI
    source: string;             // where the key was verified (URL or doc/file reference)
}

export const CATEGORIES: { id: string; label: string; description: string; icon: string }[] = [
    {
        id: 'identity',
        label: 'Identity',
        description: 'How the device shows up to everyone else: callsign, team colour, role and map symbol.',
        icon: 'IconId',
    },
    {
        id: 'reporting',
        label: 'Location & reporting',
        description: 'Whether and how often the device sends its position, and where it gets its GPS fix from.',
        icon: 'IconMapPin',
    },
    {
        id: 'display',
        label: 'Map & display',
        description: 'Coordinate format, units and on-screen behaviour.',
        icon: 'IconMap2',
    },
    {
        id: 'server',
        label: 'Server & connectivity',
        description: 'How the device talks to this server: profile updates, app updates, connection behaviour and mesh networking.',
        icon: 'IconServer',
    },
    {
        id: 'lockdown',
        label: 'Security & lockdown',
        description: 'Hide settings from users so they cannot change what you push, and turn off risky features.',
        icon: 'IconLock',
    },
    {
        id: 'data',
        label: 'Data, chat & sync',
        description: 'File sharing limits, chat notifications and how long old markers stay on the map.',
        icon: 'IconFolders',
    },
];

// ---------------------------------------------------------------------------
// Source helpers
// ---------------------------------------------------------------------------

const ATAK5 = 'https://github.com/TAK-Product-Center/atak-civ/blob/main/atak/ATAK/app/src/main';
const ATAK4 = 'https://github.com/deptofdefense/AndroidTacticalAssaultKit-CIV/blob/main/atak/ATAK/app/src/main';
const xml = (file: string) => `${ATAK5}/res/xml/${file}`;
const xml4 = (file: string) => `${ATAK4}/res/xml/${file}`;
const java = (path: string) => `${ATAK5}/java/com/atakmap/${path}`;
const HIDE_DOC = 'https://github.com/TAK-Product-Center/atak-civ/blob/main/atak/docs/SupportedPreferenceDisable.txt';
const ARRAYS = `${ATAK5}/res/values/arrays.xml`;

const S = 'class java.lang.String' as const;
const B = 'class java.lang.Boolean' as const;

// ---------------------------------------------------------------------------
// Option lists (stored values exactly as ATAK writes them)
// ---------------------------------------------------------------------------

// res/values/arrays.xml squad_values; stored value == displayed name.
const TEAM_COLOURS = [
    'White', 'Yellow', 'Orange', 'Magenta', 'Red', 'Maroon', 'Purple',
    'Dark Blue', 'Blue', 'Cyan', 'Teal', 'Green', 'Dark Green', 'Brown',
].map((c) => ({ value: c, label: c }));

// res/values/arrays.xml role_values.
const ROLES = [
    'Team Member', 'Team Lead', 'HQ', 'Sniper', 'Medic', 'Forward Observer', 'RTO', 'K9',
].map((r) => ({ value: r, label: r }));

// res/values/arrays.xml type_values / type_names (default_cot_type = a-f-G-U-C).
const UNIT_TYPES: SettingOption[] = [
    { value: 'a-f-G-U-C', label: 'Ground troop (default)' },
    { value: 'a-f-G-E-V-A', label: 'Armored vehicle' },
    { value: 'a-f-G-E-V-C', label: 'Civilian vehicle' },
    { value: 'a-f-A', label: 'Generic air unit' },
    { value: 'a-f-G-U', label: 'Generic ground unit' },
    { value: 'a-f-S', label: 'Generic sea surface unit' },
];

const hideKey = (
    target: string,
    label: string,
    description: string,
): SettingDef => ({
    key: `hidePreferenceItem_${target}`,
    label,
    description,
    category: 'lockdown',
    valueClass: B,
    input: 'toggle',
    defaultValue: 'false',
    source: `${HIDE_DOC} (hide = removed from the settings screen; built as "hidePreferenceItem_" + key in ${java('android/preference/AtakPreferenceFragment.java')})`,
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SETTINGS: SettingDef[] = [
    // ----- Identity --------------------------------------------------------
    {
        key: 'locationCallsign',
        label: 'Callsign',
        description: 'The name shown next to this device on everyone\'s map and in chat. Usually different for every device, so set it in a device- or user-specific profile rather than for everyone.',
        category: 'identity',
        valueClass: S,
        input: 'text',
        placeholder: 'e.g. RAVEN-1',
        source: `${xml('call_sign_preference.xml')}; read in ${java('android/maps/MapView.java')}`,
    },
    {
        key: 'locationTeam',
        label: 'Team colour',
        description: 'The team colour of this device\'s marker, which others see on their map and use to group contacts.',
        category: 'identity',
        valueClass: S,
        input: 'select',
        options: TEAM_COLOURS,
        defaultValue: 'Cyan',
        source: `${xml('call_sign_preference.xml')} (android:defaultValue="Cyan"); values from ${ARRAYS} squad_values`,
    },
    {
        key: 'atakRoleType',
        label: 'Role',
        description: 'The role shown on this device\'s marker (for example Team Lead or Medic).',
        category: 'identity',
        valueClass: S,
        input: 'select',
        options: ROLES,
        defaultValue: 'Team Member',
        source: `${ARRAYS} role_values; set in ${java('android/cotselector/RoleSelector.java')}; ${xml4('call_sign_preference.xml')}`,
    },
    {
        key: 'locationUnitType',
        label: 'Map symbol type',
        description: 'What kind of unit other users see this device as (a person on foot, a vehicle, an aircraft or a boat).',
        category: 'identity',
        valueClass: S,
        input: 'select',
        options: UNIT_TYPES,
        defaultValue: 'a-f-G-U-C',
        source: `${ARRAYS} type_values; read in ${java('android/location/LocationMapComponent.java')}; ${xml4('device_preferences.xml')}`,
    },
    {
        key: 'userRemarks',
        label: 'Remarks',
        description: 'Free-text remarks sent along with this device\'s information to other TAK users (ATAK 5.x only).',
        category: 'identity',
        valueClass: S,
        input: 'text',
        source: xml('call_sign_preference.xml'),
    },
    {
        key: 'saHasPhoneNumber',
        label: 'Share phone number',
        description: 'Lets other users see this device\'s phone number (if the phone knows it) and call or text it from the contact list.',
        category: 'identity',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'true',
        source: xml('contact_preferences.xml'),
    },

    // ----- Location & reporting --------------------------------------------
    {
        key: 'dispatchLocationCotExternal',
        label: 'Send my position / contact info',
        description: 'Sends this device\'s position and contact announcements over the network. Turning it off hides the device from others and breaks some features.',
        category: 'reporting',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'true',
        source: xml('reporting_preferences.xml'),
    },
    {
        key: 'dispatchLocationHidden',
        label: 'Hide my current position',
        description: 'Others can still chat with and send items to this device, but its location is not shared (an emergency alert still reveals it).',
        category: 'reporting',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: `${xml('reporting_preferences.xml')}; read in ${java('android/cot/CotMapComponent.java')}`,
    },
    {
        key: 'locationReportingStrategy',
        label: 'Position reporting strategy',
        description: 'Dynamic sends position more often while moving and less when standing still; Constant sends on a fixed interval.',
        category: 'reporting',
        valueClass: S,
        input: 'select',
        options: [
            { value: 'Dynamic', label: 'Dynamic (more often when moving)' },
            { value: 'Constant', label: 'Constant (fixed interval)' },
        ],
        defaultValue: 'Dynamic',
        source: `${xml('reporting_preferences.xml')}; values from ${ARRAYS} reporting_strategy_values; read in ${java('comms/ReportingRate.java')}`,
    },
    {
        key: 'constantReportingRateReliable',
        label: 'Constant rate – server',
        description: 'With the Constant strategy, how many seconds between position reports sent to the TAK server.',
        category: 'reporting',
        valueClass: S,
        input: 'number',
        min: 1,
        unit: 's',
        defaultValue: '15',
        source: `${xml('reporting_preferences.xml')}; parsed with Integer.parseInt(getString()) in ${java('comms/ReportingRate.java')}`,
    },
    {
        key: 'constantReportingRateUnreliable',
        label: 'Constant rate – mesh',
        description: 'With the Constant strategy, how many seconds between position reports sent over the local mesh/multicast network.',
        category: 'reporting',
        valueClass: S,
        input: 'number',
        min: 1,
        unit: 's',
        defaultValue: '3',
        source: `${xml('reporting_preferences.xml')}; ${java('comms/ReportingRate.java')}`,
    },
    {
        key: 'dynamicReportingRateStationaryReliable',
        label: 'Dynamic rate – server, standing still',
        description: 'With the Dynamic strategy, seconds between position reports to the server while the device is not moving.',
        category: 'reporting',
        valueClass: S,
        input: 'number',
        min: 1,
        unit: 's',
        defaultValue: '180',
        source: `${xml('reporting_preferences.xml')}; ${java('comms/ReportingRate.java')}`,
    },
    {
        key: 'dynamicReportingRateMinReliable',
        label: 'Dynamic rate – server, moving slowly',
        description: 'With the Dynamic strategy, the longest gap in seconds between position reports to the server while moving slowly.',
        category: 'reporting',
        valueClass: S,
        input: 'number',
        min: 1,
        unit: 's',
        defaultValue: '20',
        source: `${xml('reporting_preferences.xml')}; ${java('comms/ReportingRate.java')}`,
    },
    {
        key: 'dynamicReportingRateMaxReliable',
        label: 'Dynamic rate – server, moving fast',
        description: 'With the Dynamic strategy, the shortest gap in seconds between position reports to the server while moving fast.',
        category: 'reporting',
        valueClass: S,
        input: 'number',
        min: 1,
        unit: 's',
        defaultValue: '2',
        source: `${xml('reporting_preferences.xml')}; ${java('comms/ReportingRate.java')}`,
    },
    {
        key: 'dynamicReportingRateStationaryUnreliable',
        label: 'Dynamic rate – mesh, standing still',
        description: 'With the Dynamic strategy, seconds between position reports over the mesh network while the device is not moving.',
        category: 'reporting',
        valueClass: S,
        input: 'number',
        min: 1,
        unit: 's',
        defaultValue: '30',
        source: `${xml('reporting_preferences.xml')}; ${java('comms/ReportingRate.java')}`,
    },
    {
        key: 'dynamicReportingRateMinUnreliable',
        label: 'Dynamic rate – mesh, moving slowly',
        description: 'With the Dynamic strategy, the longest gap in seconds between mesh position reports while moving slowly.',
        category: 'reporting',
        valueClass: S,
        input: 'number',
        min: 1,
        unit: 's',
        defaultValue: '20',
        source: `${xml('reporting_preferences.xml')}; ${java('comms/ReportingRate.java')}`,
    },
    {
        key: 'dynamicReportingRateMaxUnreliable',
        label: 'Dynamic rate – mesh, moving fast',
        description: 'With the Dynamic strategy, the shortest gap in seconds between mesh position reports while moving fast.',
        category: 'reporting',
        valueClass: S,
        input: 'number',
        min: 1,
        unit: 's',
        defaultValue: '2',
        source: `${xml('reporting_preferences.xml')}; ${java('comms/ReportingRate.java')}`,
    },
    {
        key: 'dispatchLocationCotExternalAtStart',
        label: 'Report before GPS fix',
        description: 'Sends a position report (at 0,0) as soon as the app starts, before the device has a GPS fix or a manually placed location.',
        category: 'reporting',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'true',
        source: xml('reporting_preferences.xml'),
    },
    {
        key: 'restoreRecordedLocation',
        label: 'Restore last location on restart',
        description: 'Puts the self marker back at its last known location when ATAK restarts without GPS, useful in GPS-denied areas (ATAK 5.x only).',
        category: 'reporting',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: xml('reporting_preferences.xml'),
    },
    {
        key: 'mockingOption',
        label: 'GPS source',
        description: 'Where the device gets its location from: the phone\'s own GPS, an external or network GPS, or external with fallback to internal.',
        category: 'reporting',
        valueClass: S,
        input: 'select',
        options: [
            { value: 'WRGPS', label: 'External or network GPS, fall back to internal' },
            { value: 'LocalGPS', label: 'Internal GPS only' },
            { value: 'IgnoreInternalGPS', label: 'External or network GPS only' },
        ],
        defaultValue: 'WRGPS',
        source: `${xml('network_gps_preferences.xml')}; read in ${java('android/location/LocationMapComponent.java')}`,
    },
    {
        key: 'useGPSTime',
        label: 'Use GPS time',
        description: 'Uses the time from GPS instead of the phone clock when a GPS fix is available.',
        category: 'reporting',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'true',
        source: xml('network_gps_preferences.xml'),
    },

    // ----- Map & display ---------------------------------------------------
    {
        key: 'coord_display_pref',
        label: 'Coordinate format',
        description: 'How coordinates are shown throughout the app.',
        category: 'display',
        valueClass: S,
        input: 'select',
        options: [
            { value: 'MGRS', label: 'MGRS' },
            { value: 'DD', label: 'Decimal degrees' },
            { value: 'DM', label: 'Degrees, minutes' },
            { value: 'DMS', label: 'Degrees, minutes, seconds' },
            { value: 'UTM', label: 'UTM' },
        ],
        defaultValue: 'MGRS',
        source: `${xml('unit_display_preferences.xml')}; read in ${java('coremap/conversions/CoordinateFormat.java')}`,
    },
    {
        key: 'alt_display_pref',
        label: 'Altitude reference',
        description: 'Whether altitudes are shown as height above mean sea level or above the ellipsoid.',
        category: 'display',
        valueClass: S,
        input: 'select',
        options: [
            { value: 'MSL', label: 'Mean sea level (MSL)' },
            { value: 'HAE', label: 'Height above ellipsoid (HAE)' },
        ],
        defaultValue: 'MSL',
        source: xml('unit_display_preferences.xml'),
    },
    {
        key: 'alt_unit_pref',
        label: 'Altitude units',
        description: 'Units used for altitudes and elevations.',
        category: 'display',
        valueClass: S,
        input: 'select',
        options: [
            { value: '0', label: 'Feet' },
            { value: '1', label: 'Metres' },
        ],
        defaultValue: '0',
        source: `${xml('unit_display_preferences.xml')}; parsed as int from a String in ${java('android/elev/ElevationChooserDialog.java')}`,
    },
    {
        key: 'speed_unit_pref',
        label: 'Speed units',
        description: 'Units used to show speeds.',
        category: 'display',
        valueClass: S,
        input: 'select',
        options: [
            { value: '0', label: 'Miles per hour' },
            { value: '1', label: 'Kilometres per hour' },
            { value: '2', label: 'Knots' },
            { value: '3', label: 'Metres per second' },
        ],
        defaultValue: '0',
        source: xml('unit_display_preferences.xml'),
    },
    {
        key: 'rab_rng_units_pref',
        label: 'Distance units',
        description: 'Units used for ranges and distances.',
        category: 'display',
        valueClass: S,
        input: 'select',
        options: [
            { value: '0', label: 'Feet / miles' },
            { value: '1', label: 'Metres / kilometres' },
            { value: '2', label: 'Nautical miles' },
        ],
        defaultValue: '1',
        source: xml('unit_display_preferences.xml'),
    },
    {
        key: 'rab_brg_units_pref',
        label: 'Bearing units',
        description: 'Whether bearings are shown in degrees or mils.',
        category: 'display',
        valueClass: S,
        input: 'select',
        options: [
            { value: '0', label: 'Degrees' },
            { value: '1', label: 'Mils' },
        ],
        defaultValue: '0',
        source: xml('unit_display_preferences.xml'),
    },
    {
        key: 'rab_north_ref_pref',
        label: 'North reference',
        description: 'Which north bearings are measured from.',
        category: 'display',
        valueClass: S,
        input: 'select',
        options: [
            { value: '0', label: 'True north' },
            { value: '1', label: 'Magnetic north' },
            { value: '2', label: 'Grid north' },
        ],
        defaultValue: '1',
        source: xml('unit_display_preferences.xml'),
    },
    {
        key: 'self_coord_info_display',
        label: 'My coordinates box',
        description: 'Where the device\'s own coordinates are shown on screen, or whether they are shown at all.',
        category: 'display',
        valueClass: S,
        input: 'select',
        options: [
            { value: 'bottom_right', label: 'Bottom-right box' },
            { value: 'bottom_bar', label: 'Bottom bar' },
            { value: 'none', label: 'Do not display' },
        ],
        defaultValue: 'bottom_right',
        source: xml('basic_display_settings.xml'),
    },
    {
        key: 'atakControlShowLabels',
        label: 'Show marker labels',
        description: 'Shows the name label under each marker on the map.',
        category: 'display',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'true',
        source: xml('other_display_prefs.xml'),
    },
    {
        key: 'displayAsSymbologyGraphic',
        label: 'Show users as military symbols',
        description: 'Draws other TAK users as their military symbol instead of a circle in their team colour (ATAK 5.x only).',
        category: 'display',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: xml('other_display_prefs.xml'),
    },
    {
        key: 'atakScreenLock',
        label: 'Keep screen on',
        description: 'Stops the screen saver and screen lock from kicking in while ATAK is running.',
        category: 'display',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: `${xml('other_display_prefs.xml')}; read in ${java('android/util/DisplayManager.java')}`,
    },
    {
        key: 'largeTextMode',
        label: 'Large text mode',
        description: 'Makes the toolbar, icons and text larger, which helps with gloves or small screens.',
        category: 'display',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: xml('usability_settings.xml'),
    },
    {
        key: 'prefs_grid_default_show',
        label: 'Show grid lines on startup',
        description: 'Turns the map grid lines on every time ATAK starts.',
        category: 'display',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: xml('gridlines_preferences.xml'),
    },

    // ----- Server & connectivity -------------------------------------------
    {
        key: 'deviceProfileEnableOnConnect',
        label: 'Apply server profile updates on connect',
        description: 'Lets the device fetch and apply settings and data from this server every time it connects. Profiles set to apply "every time ATAK connects" only reach devices with this on. This server already switches it on when a device enrolls.',
        category: 'server',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: `${xml('network_connections_preferences.xml')} ("Apply TAK Server profile updates"); checked before the on-connect request in ${java('net/DeviceProfileClient.java')}`,
    },
    {
        key: 'repoStartupSync',
        label: 'Check for app updates at startup',
        description: 'Checks the app/plugin update server every time ATAK starts, instead of only after an ATAK upgrade. This is about app and plugin updates, not settings profiles.',
        category: 'server',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: `${xml('app_mgmt_preferences.xml')} ("Auto Sync"); read in ${java('android/update/ProductProviderManager.java')}`,
    },
    {
        key: 'appMgmtEnableUpdateServer',
        label: 'Use update server',
        description: 'Lets the device install app and plugin updates over the air from a TAK update server.',
        category: 'server',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: xml('app_mgmt_preferences.xml'),
    },
    {
        key: 'atakUpdateServerUrl',
        label: 'Update server URL',
        description: 'The address of the TAK update server to get apps and plugins from.',
        category: 'server',
        valueClass: S,
        input: 'text',
        placeholder: 'https://server:8443/api/packages',
        defaultValue: '',
        source: xml('app_mgmt_preferences.xml'),
    },
    {
        key: 'displayServerConnectionWidget',
        label: 'Show connection indicator',
        description: 'Shows a server connection indicator on the map above the device\'s own location box.',
        category: 'server',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: xml('network_connections_preferences.xml'),
    },
    {
        key: 'monitorServerConnections',
        label: 'Monitor server connections',
        description: 'Pings the server after periods of inactivity so dropped connections are noticed and reconnected sooner (uses a little extra data).',
        category: 'server',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'true',
        source: xml('network_connections_preferences.xml'),
    },
    {
        key: 'enableNonStreamingConnections',
        label: 'Mesh network mode',
        description: 'Allows local multicast (mesh) traffic. Turn off to send and receive only through the server.',
        category: 'server',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'true',
        source: xml('network_connections_preferences.xml'),
    },
    {
        key: 'autoDisableMeshSAWhenStreaming',
        label: 'Prefer server over mesh when connected',
        description: 'While connected to a server, sends the device\'s own position over the server instead of the local mesh network.',
        category: 'server',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: xml('network_connections_preferences.xml'),
    },
    {
        key: 'onlyStreamingWithVPN',
        label: 'Only connect over VPN',
        description: 'Only allows server connections while a VPN is up; without the VPN the server connection stays off (ATAK 5.x only).',
        category: 'server',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: xml('network_connections_preferences.xml'),
    },
    {
        key: 'tcpConnectTimeout',
        label: 'Connection timeout',
        description: 'How long in seconds the device waits for a server connection to open before treating it as failed.',
        category: 'server',
        valueClass: S,
        input: 'number',
        min: 1,
        unit: 's',
        defaultValue: '20',
        source: xml('network_connections_preferences.xml'),
    },
    {
        key: 'apiSecureServerPort',
        label: 'Secure API port',
        description: 'The HTTPS port of the server API the device uses for things like data packages and profiles.',
        category: 'server',
        valueClass: S,
        input: 'number',
        min: 1,
        max: 65535,
        defaultValue: '8443',
        source: xml('network_connections_preferences.xml'),
    },
    {
        key: 'apiCertEnrollmentPort',
        label: 'Certificate enrollment port',
        description: 'The port the device uses to request its client certificate when enrolling with a username and password.',
        category: 'server',
        valueClass: S,
        input: 'number',
        min: 1,
        max: 65535,
        defaultValue: '8446',
        source: `${xml('network_connections_preferences.xml')}; parsed with Integer.parseInt(getString()) in ${java('android/cot/CotMapComponent.java')}`,
    },
    {
        key: 'enableAutoUploadLogs',
        label: 'Upload app logs at startup',
        description: 'Uploads the app\'s logs to the TAK server each time ATAK starts, which helps troubleshooting.',
        category: 'server',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: xml('logging_preferences.xml'),
    },

    // ----- Security & lockdown ---------------------------------------------
    {
        key: 'broadcast_disable',
        label: 'Disable broadcast button',
        description: 'Turns off the broadcast button while connected to a server, so users cannot accidentally send items to everyone (ATAK 5.x only).',
        category: 'lockdown',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: xml('other_display_prefs.xml'),
    },
    hideKey('locationCallsign', 'Hide callsign setting', 'Removes the callsign field from the settings screen so users cannot rename themselves.'),
    hideKey('locationTeam', 'Hide team setting', 'Removes the team colour choice from the settings screen so users cannot change team.'),
    hideKey('manageStreamingLink', 'Hide server connections', 'Removes "Manage Server Connections" from settings so users cannot add, edit or delete server connections.'),
    hideKey('networkSettings', 'Hide network settings', 'Removes the whole Network Connection Preferences screen from settings.'),
    hideKey('reportingSettings', 'Hide reporting settings', 'Removes the Reporting Preferences screen so users cannot change how often they report position.'),
    hideKey('deviceProfileEnableOnConnect', 'Hide "apply profile updates" switch', 'Removes the "Apply TAK Server profile updates" switch so users cannot stop receiving profiles from this server.'),
    hideKey('dispatchLocationHidden', 'Hide "hide my position" switch', 'Removes the "Hide my current position" switch so users cannot stop sharing their location.'),
    hideKey('loadPrefs', 'Hide "load preferences"', 'Removes the option to load a preference file from the device.'),
    hideKey('savePrefs', 'Hide "save preferences"', 'Removes the option to save the current settings to a file.'),
    hideKey('myPlugins', 'Hide plugin management', 'Removes the TAK Package Management (plugins and apps) entry from settings.'),

    // ----- Data, chat & sync -----------------------------------------------
    {
        key: 'filesharingEnabled',
        label: 'File sharing',
        description: 'Allows sending and receiving files and data packages.',
        category: 'data',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'true',
        source: xml('missionpackage_preferences.xml'),
    },
    {
        key: 'filesharingSizeThresholdNoGo',
        label: 'Maximum file transfer size',
        description: 'Blocks sending a file or data package larger than this many megabytes.',
        category: 'data',
        valueClass: S,
        input: 'number',
        min: 1,
        unit: 'MB',
        defaultValue: '20',
        source: `${xml('missionpackage_preferences.xml')}; read as String in ${java('android/user/feedback/UserFeedbackAdapter.java')}`,
    },
    {
        key: 'staleRemoteDisconnects',
        label: 'Remove users when they disconnect',
        description: 'Immediately marks other users as stale when they (or this device) disconnect from the server, instead of waiting for their reports to time out.',
        category: 'data',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'true',
        source: xml('stale_data_prefs.xml'),
    },
    {
        key: 'expireEverything',
        label: 'Remove all stale markers',
        description: 'Deletes every kind of (non-archived) marker from the device once it goes stale, not just users.',
        category: 'data',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'true',
        source: xml('stale_data_prefs.xml'),
    },
    {
        key: 'expireStaleItemsTime',
        label: 'Stale marker clean-up time',
        description: 'How long a marker stays on the device after it goes stale before it is deleted.',
        category: 'data',
        valueClass: S,
        input: 'select',
        options: [
            { value: '0', label: 'Immediately' },
            { value: '1', label: '1 minute' },
            { value: '5', label: '5 minutes' },
            { value: '20', label: '20 minutes' },
            { value: '60', label: '1 hour' },
            { value: '360', label: '6 hours' },
            { value: '1440', label: '1 day' },
        ],
        defaultValue: '5',
        source: `${xml('stale_data_prefs.xml')}; parsed from a String in ${java('android/cot/CotMarkerRefresher.java')}`,
    },
    {
        key: 'enableToast',
        label: 'Chat notifications',
        description: 'Shows a notification whenever a new chat message arrives.',
        category: 'data',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'true',
        source: xml('chat_preferences.xml'),
    },
    {
        key: 'audibleNotify',
        label: 'Chat notification sound',
        description: 'Plays the notification sound for new chat messages (needs chat notifications on).',
        category: 'data',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: xml('chat_preferences.xml'),
    },
    {
        key: 'vibratePhone',
        label: 'Vibrate on chat',
        description: 'Vibrates the phone for new chat messages (needs chat notifications on).',
        category: 'data',
        valueClass: B,
        input: 'toggle',
        defaultValue: 'false',
        source: xml('chat_preferences.xml'),
    },
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

export function findSetting(key: string): SettingDef | undefined {
    return BY_KEY.get(key);
}
