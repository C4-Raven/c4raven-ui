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
    name: 'c4raven-ui',
    versionDate: '2026-11-03T04:02:14.472Z',
    gitCommitHash: 'cc28439',
    versionLong: '0.0.0-cc28439',
};
export default versions;
