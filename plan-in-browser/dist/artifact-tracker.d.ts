export type ArtifactDiff = {
    text: string;
    additions: number;
    deletions: number;
    against: "HEAD" | "/dev/null";
};
export type Artifact = {
    id: string;
    path: string;
    displayPath: string;
    title?: string;
    revision: number;
    content?: string;
    error?: string;
    diff?: ArtifactDiff;
};
export type ArtifactInput = {
    path: string;
    title?: string;
};
type ArtifactTrackerOptions = {
    sessionDir: string;
    cwd: string;
};
export declare class ArtifactTracker {
    readonly sessionDir: string;
    readonly cwd: string;
    private readonly storeFile;
    private artifacts;
    constructor({ sessionDir, cwd }: ArtifactTrackerOptions);
    register(input: ArtifactInput): {
        id: string;
        path: string;
    };
    snapshot(): Artifact[];
    private refresh;
    private readStore;
    private persist;
}
export {};
