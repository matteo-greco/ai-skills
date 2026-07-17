import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync, } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
const MAX_ARTIFACT_BYTES = 512 * 1024;
function runGit(args) {
    return spawnSync("git", args, {
        encoding: "utf8",
        maxBuffer: MAX_ARTIFACT_BYTES * 4,
        windowsHide: true,
    });
}
function countDiffChanges(text) {
    let additions = 0;
    let deletions = 0;
    let inHunk = false;
    for (const line of text.split("\n")) {
        if (line.startsWith("@@")) {
            inHunk = true;
            continue;
        }
        if (!inHunk)
            continue;
        if (line.startsWith("+"))
            additions += 1;
        else if (line.startsWith("-"))
            deletions += 1;
    }
    return { additions, deletions };
}
function gitDiff(path, hasContent) {
    const worktree = runGit(["-C", dirname(path), "rev-parse", "--show-toplevel"]);
    if (worktree.status !== 0)
        return undefined;
    const root = worktree.stdout.trim();
    let canonicalPath;
    try {
        canonicalPath = realpathSync(path);
    }
    catch {
        canonicalPath = path;
    }
    const displayPath = relative(root, canonicalPath);
    if (!displayPath || displayPath === ".." || displayPath.startsWith("../") || displayPath.startsWith("..\\")) {
        return undefined;
    }
    const tracked = runGit(["-C", root, "ls-files", "--error-unmatch", "--", displayPath]).status === 0;
    const hasHead = runGit(["-C", root, "rev-parse", "--verify", "HEAD"]).status === 0;
    let result;
    if (tracked && hasHead) {
        result = runGit([
            "-C", root, "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--unified=3", "HEAD", "--", displayPath,
        ]);
        if (result.status !== 0)
            return undefined;
    }
    else if (hasContent) {
        result = runGit([
            "-C", root, "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--unified=3", "--no-index", "--", "/dev/null", displayPath,
        ]);
        if (result.status !== 0 && result.status !== 1)
            return undefined;
    }
    else {
        return undefined;
    }
    const text = result.stdout;
    if (!text.includes("@@"))
        return undefined;
    return { text, ...countDiffChanges(text), against: tracked && hasHead ? "HEAD" : "/dev/null" };
}
export class ArtifactTracker {
    sessionDir;
    cwd;
    storeFile;
    artifacts;
    constructor({ sessionDir, cwd }) {
        this.sessionDir = sessionDir;
        this.cwd = cwd;
        this.storeFile = resolve(sessionDir, "artifacts.json");
        mkdirSync(sessionDir, { recursive: true });
        this.artifacts = this.readStore();
    }
    register(input) {
        const path = isAbsolute(input.path) ? resolve(input.path) : resolve(this.cwd, input.path);
        let artifact = this.artifacts.find((candidate) => candidate.path === path);
        if (!artifact) {
            const displayPath = relative(this.cwd, path);
            artifact = {
                id: `artifact-${this.artifacts.length + 1}`,
                path,
                displayPath: displayPath && !displayPath.startsWith("..") ? displayPath : path,
                title: input.title?.trim() || undefined,
                revision: 0,
            };
            this.artifacts.push(artifact);
        }
        else if (input.title?.trim()) {
            artifact.title = input.title.trim();
        }
        this.refresh(artifact);
        this.persist();
        return { id: artifact.id, path: artifact.path };
    }
    snapshot() {
        let changed = false;
        for (const artifact of this.artifacts)
            changed = this.refresh(artifact) || changed;
        if (changed)
            this.persist();
        return structuredClone(this.artifacts);
    }
    refresh(artifact) {
        let content;
        let error;
        try {
            const stats = statSync(artifact.path);
            if (!stats.isFile())
                throw new Error("Not a regular file");
            if (stats.size > MAX_ARTIFACT_BYTES) {
                throw new Error(`File is larger than ${Math.round(MAX_ARTIFACT_BYTES / 1024)} KB`);
            }
            const buffer = readFileSync(artifact.path);
            if (buffer.includes(0))
                throw new Error("Binary files cannot be displayed");
            content = buffer.toString("utf8");
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
        }
        const diff = gitDiff(artifact.path, content !== undefined);
        const unchangedDiff = artifact.diff?.text === diff?.text
            && artifact.diff?.additions === diff?.additions
            && artifact.diff?.deletions === diff?.deletions
            && artifact.diff?.against === diff?.against;
        if (artifact.content === content && artifact.error === error && unchangedDiff)
            return false;
        if (content === undefined)
            delete artifact.content;
        else
            artifact.content = content;
        if (error === undefined)
            delete artifact.error;
        else
            artifact.error = error;
        if (diff === undefined)
            delete artifact.diff;
        else
            artifact.diff = diff;
        artifact.revision += 1;
        return true;
    }
    readStore() {
        if (!existsSync(this.storeFile))
            return [];
        try {
            const stored = JSON.parse(readFileSync(this.storeFile, "utf8"));
            return Array.isArray(stored.artifacts) ? stored.artifacts : [];
        }
        catch {
            return [];
        }
    }
    persist() {
        const temporary = `${this.storeFile}.tmp`;
        writeFileSync(temporary, JSON.stringify({ artifacts: this.artifacts }, null, 2), { mode: 0o600 });
        renameSync(temporary, this.storeFile);
    }
}
