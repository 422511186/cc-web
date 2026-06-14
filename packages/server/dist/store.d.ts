import type { Project, Session, SessionDetail } from '@cc-web/shared';
export declare class SessionStore {
    private projectsDir;
    constructor(projectsDir: string);
    listProjects(): Promise<Project[]>;
    listSessions(projectId: string): Promise<Session[]>;
    getSession(projectId: string, sessionId: string): Promise<SessionDetail | null>;
    private decodeProjectName;
    private decodeProjectPath;
}
//# sourceMappingURL=store.d.ts.map