export interface TsAppVersion {
    version: string;
    name: string;
    description?: string;
    versionLong?: string;
    versionDate: string;
    gitCommitHash?: string;
    gitCommitDate?: string;
    gitTag?: string;
};
export const versions: TsAppVersion = {
    version: '0.0.0',
    name: 'opentakserver-ui',
    versionDate: '2026-09-01T01:29:04.793Z',
    gitCommitHash: 'cb5ef93',
    versionLong: '0.0.0-cb5ef93',
};
export default versions;
