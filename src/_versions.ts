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
    versionDate: '2026-09-18T22:41:02.893Z',
    gitCommitHash: 'f59e04a',
    versionLong: '0.0.0-f59e04a',
};
export default versions;
