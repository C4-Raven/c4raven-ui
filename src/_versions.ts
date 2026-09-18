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
    versionDate: '2026-09-18T05:23:03.169Z',
    gitCommitHash: '7da9eda',
    versionLong: '0.0.0-7da9eda',
};
export default versions;
