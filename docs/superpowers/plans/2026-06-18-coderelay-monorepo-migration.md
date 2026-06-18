# CodeRelay Monorepo 迁移实施计划

> **给 agentic workers:** REQUIRED SUB-SKILL: 使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 将现有 `cc-web` monorepo 重命名并迁移到 CodeRelay 的 `apps/` + `packages/` 结构，同时保持当前 HTTP / ZeroTier 访问方式完全可用。

**架构：** 运行时应用进入 `apps/`，共享库留在 `packages/`；workspace 包名从 `@cc-web/*` 改为 `@coderelay/*`；为后续 Signal、Transport、P2P Core、Test Utils 新增可构建的空实现包。本计划不实现 WebRTC、扫码配对、Signal 业务、P2PTransport 或 TURN，只建立后续计划依赖的稳定结构。

**技术栈：** npm workspaces、TypeScript project references、Vitest、Vite/React、Express/Node、Windows bat 启动脚本。

---

## 范围检查

已批准的 CodeRelay P2P spec 覆盖多个独立子系统。本计划只覆盖第一个可独立验证的切片：

```text
CodeRelay monorepo 结构迁移
+ package rename
+ 未来包 scaffold
+ 保持现有 HTTP 模式可用
```

以下内容必须另写后续计划：

- Transport 抽象。
- 设备身份与二维码配对。
- CodeRelay Signal 的实际 WebSocket 协议。
- WebRTC DataChannel 建连。
- P2PTransport 接入业务。
- TURN / Transit 兜底。

## 文件结构

本计划完成后的目标结构：

```text
apps/
  host/
    package.json
    tsconfig.json
    vitest.config.ts
    src/
  web/
    package.json
    tsconfig.json
    vite.config.ts
    vitest.config.ts
    src/
  signal/
    package.json
    tsconfig.json
    vitest.config.ts
    src/index.ts
    src/smoke.test.ts

packages/
  shared/
    package.json
    tsconfig.json
    vitest.config.ts
    src/
  transport/
    package.json
    tsconfig.json
    vitest.config.ts
    src/index.ts
    src/smoke.test.ts
  p2p-core/
    package.json
    tsconfig.json
    vitest.config.ts
    src/index.ts
    src/smoke.test.ts
  test-utils/
    package.json
    tsconfig.json
    vitest.config.ts
    src/index.ts
    src/smoke.test.ts
```

兼容性决策：

- import 包名从 `@cc-web/shared` 改为 `@coderelay/shared`。
- root package/workspace/script 改为 CodeRelay 命名。
- 浏览器持久化键，例如 `cc-web-activeRuns`，本计划不改名。它们是用户已有运行态，若要迁移需单独设计兼容迁移。
- 诊断日志前缀，例如 `[cc-web:client]`，本计划不强制改名。它们不是包边界。
- 保留根脚本 `dev:server`，作为 `dev:host` 的兼容别名。
- 新增 `start-host.bat`，保留 `start-server.bat` 作为兼容包装。

## Task 1: 先写 workspace 结构契约测试

**文件：**

- Modify: `packages/shared/src/coverageConfig.test.ts`

- [ ] **步骤 1：替换 workspace coverage 契约测试**

将 `packages/shared/src/coverageConfig.test.ts` 完整替换为：

```typescript
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(thisDir, "../../../");

function readJson(relativePath: string): any {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf8"));
}

const workspaces = [
  {
    path: "apps/host",
    packageName: "@coderelay/host",
  },
  {
    path: "apps/web",
    packageName: "@coderelay/web",
  },
  {
    path: "apps/signal",
    packageName: "@coderelay/signal",
  },
  {
    path: "packages/shared",
    packageName: "@coderelay/shared",
  },
  {
    path: "packages/transport",
    packageName: "@coderelay/transport",
  },
  {
    path: "packages/p2p-core",
    packageName: "@coderelay/p2p-core",
  },
  {
    path: "packages/test-utils",
    packageName: "@coderelay/test-utils",
  },
];

describe("coverage configuration", () => {
  it("root 与各 workspace 都应提供 test:coverage 脚本", () => {
    const rootPkg = readJson("package.json");
    expect(rootPkg.name).toBe("coderelay");
    expect(rootPkg.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(rootPkg.scripts["test:coverage"]).toBeTruthy();

    for (const workspace of workspaces) {
      const pkg = readJson(`${workspace.path}/package.json`);
      expect(pkg.name).toBe(workspace.packageName);
      expect(pkg.scripts["test:coverage"]).toBeTruthy();
    }
  });

  it("所有 CodeRelay workspace 的 Vitest 配置都应声明 v8 coverage 与 thresholds", () => {
    for (const workspace of workspaces) {
      const fullPath = resolve(repoRoot, workspace.path, "vitest.config.ts");
      expect(existsSync(fullPath)).toBe(true);

      const content = readFileSync(fullPath, "utf8");
      expect(content).toContain("provider: 'v8'");
      expect(content).toContain("thresholds");
    }
  });

  it("不应跟踪已被 .gitignore 忽略的依赖或构建产物", () => {
    const ignoredTrackedFiles = execFileSync(
      "git",
      ["ls-files", "-ci", "--exclude-standard"],
      { cwd: repoRoot, encoding: "utf8" }
    )
      .split(/\r?\n/)
      .filter(Boolean);

    expect(ignoredTrackedFiles).toEqual([]);
  });
});
```

- [ ] **步骤 2：运行聚焦测试并确认 RED**

Run:

```bash
npm test --workspace @cc-web/shared -- src/coverageConfig.test.ts
```

预期：FAIL。失败原因应是根 `package.json` 仍叫 `cc-web`、workspace 仍是旧路径，且 `apps/host/package.json` 尚不存在。

- [ ] **步骤 3：暂不提交**

保留失败测试，Task 2 负责让它变绿。

## Task 2: 迁移 workspace 并重命名包

**文件：**

- Modify: `package.json`
- Modify: `package-lock.json`
- Move: `packages/server/` -> `apps/host/`
- Move: `packages/web/` -> `apps/web/`
- Modify: `apps/host/package.json`
- Modify: `apps/host/tsconfig.json`
- Modify: `apps/web/package.json`
- Modify: `apps/web/tsconfig.json`
- Modify: `packages/shared/package.json`
- Create: `apps/signal/package.json`
- Create: `apps/signal/tsconfig.json`
- Create: `apps/signal/vitest.config.ts`
- Create: `apps/signal/src/index.ts`
- Create: `apps/signal/src/smoke.test.ts`
- Create: `packages/transport/package.json`
- Create: `packages/transport/tsconfig.json`
- Create: `packages/transport/vitest.config.ts`
- Create: `packages/transport/src/index.ts`
- Create: `packages/transport/src/smoke.test.ts`
- Create: `packages/p2p-core/package.json`
- Create: `packages/p2p-core/tsconfig.json`
- Create: `packages/p2p-core/vitest.config.ts`
- Create: `packages/p2p-core/src/index.ts`
- Create: `packages/p2p-core/src/smoke.test.ts`
- Create: `packages/test-utils/package.json`
- Create: `packages/test-utils/tsconfig.json`
- Create: `packages/test-utils/vitest.config.ts`
- Create: `packages/test-utils/src/index.ts`
- Create: `packages/test-utils/src/smoke.test.ts`

- [ ] **步骤 1：用 Git 移动现有 app 目录**

Run:

```bash
mkdir apps
git mv packages/server apps/host
git mv packages/web apps/web
```

预期：`apps/host` 和 `apps/web` 存在；`packages/server` 和 `packages/web` 不再存在。

- [ ] **步骤 2：替换根 `package.json`**

将 `package.json` 完整替换为：

```json
{
  "name": "coderelay",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "test:coverage": "npm run test:coverage --workspaces --if-present",
    "dev:host": "npm run dev --workspace @coderelay/host",
    "dev:server": "npm run dev:host",
    "dev:web": "npm run dev --workspace @coderelay/web",
    "dev:signal": "npm run dev --workspace @coderelay/signal"
  },
  "dependencies": {
    "marked": "^18.0.5"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^2.1.9"
  }
}
```

- [ ] **步骤 3：替换 `apps/host/package.json`**

将 `apps/host/package.json` 完整替换为：

```json
{
  "name": "@coderelay/host",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.3.177",
    "@coderelay/shared": "*",
    "chokidar": "^5.0.0",
    "express": "^4.21.2",
    "multer": "^2.0.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/multer": "^1.4.12",
    "@types/node": "^22.10.5",
    "@types/supertest": "^6.0.3",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **步骤 4：替换 `apps/web/package.json`**

将 `apps/web/package.json` 完整替换为：

```json
{
  "name": "@coderelay/web",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@coderelay/shared": "*",
    "dompurify": "^3.4.10",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-window": "^2.2.7"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/dompurify": "^3.0.5",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@types/react-window": "^1.8.8",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^29.1.1",
    "typescript": "^5.7.3",
    "vite": "^6.0.7",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **步骤 5：更新 `packages/shared/package.json`**

只修改 package name：

```json
"name": "@coderelay/shared"
```

保留现有 `main`、`types`、`exports` 和 scripts。

- [ ] **步骤 6：更新 TypeScript project references**

在 `apps/host/tsconfig.json` 中，将：

```json
{ "path": "../shared" }
```

替换为：

```json
{ "path": "../../packages/shared" }
```

在 `apps/web/tsconfig.json` 中，将：

```json
{ "path": "../shared" }
```

替换为：

```json
{ "path": "../../packages/shared" }
```

- [ ] **步骤 7：创建 `apps/signal` scaffold**

创建 `apps/signal/package.json`：

```json
{
  "name": "@coderelay/signal",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

创建 `apps/signal/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

创建 `apps/signal/vitest.config.ts`：

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
```

创建 `apps/signal/src/index.ts`：

```typescript
export function signalServiceName(): string {
  return "CodeRelay Signal";
}
```

创建 `apps/signal/src/smoke.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { signalServiceName } from "./index.js";

describe("CodeRelay Signal scaffold", () => {
  it("exposes the service name", () => {
    expect(signalServiceName()).toBe("CodeRelay Signal");
  });
});
```

- [ ] **步骤 8：创建 `packages/transport` scaffold**

创建 `packages/transport/package.json`：

```json
{
  "name": "@coderelay/transport",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

创建 `packages/transport/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

创建 `packages/transport/vitest.config.ts`：

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
```

创建 `packages/transport/src/index.ts`：

```typescript
export interface TransportScaffold {
  readonly packageName: "@coderelay/transport";
}

export function createTransportScaffold(): TransportScaffold {
  return { packageName: "@coderelay/transport" };
}
```

创建 `packages/transport/src/smoke.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { createTransportScaffold } from "./index.js";

describe("@coderelay/transport scaffold", () => {
  it("exposes the package name", () => {
    expect(createTransportScaffold().packageName).toBe("@coderelay/transport");
  });
});
```

- [ ] **步骤 9：创建 `packages/p2p-core` scaffold**

创建 `packages/p2p-core/package.json`：

```json
{
  "name": "@coderelay/p2p-core",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

创建 `packages/p2p-core/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

创建 `packages/p2p-core/vitest.config.ts`：

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
```

创建 `packages/p2p-core/src/index.ts`：

```typescript
export interface P2pCoreScaffold {
  readonly packageName: "@coderelay/p2p-core";
}

export function createP2pCoreScaffold(): P2pCoreScaffold {
  return { packageName: "@coderelay/p2p-core" };
}
```

创建 `packages/p2p-core/src/smoke.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { createP2pCoreScaffold } from "./index.js";

describe("@coderelay/p2p-core scaffold", () => {
  it("exposes the package name", () => {
    expect(createP2pCoreScaffold().packageName).toBe("@coderelay/p2p-core");
  });
});
```

- [ ] **步骤 10：创建 `packages/test-utils` scaffold**

创建 `packages/test-utils/package.json`：

```json
{
  "name": "@coderelay/test-utils",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

创建 `packages/test-utils/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

创建 `packages/test-utils/vitest.config.ts`：

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
```

创建 `packages/test-utils/src/index.ts`：

```typescript
export interface TestUtilsScaffold {
  readonly packageName: "@coderelay/test-utils";
}

export function createTestUtilsScaffold(): TestUtilsScaffold {
  return { packageName: "@coderelay/test-utils" };
}
```

创建 `packages/test-utils/src/smoke.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { createTestUtilsScaffold } from "./index.js";

describe("@coderelay/test-utils scaffold", () => {
  it("exposes the package name", () => {
    expect(createTestUtilsScaffold().packageName).toBe("@coderelay/test-utils");
  });
});
```

- [ ] **步骤 11：替换 shared package import specifier**

在 `apps/host`、`apps/web`、`packages/shared` 下做机械替换：

```text
@cc-web/shared -> @coderelay/shared
```

替换后运行：

```bash
rg -n "@cc-web/shared" apps packages
```

预期：无匹配。

- [ ] **步骤 12：更新 lockfile**

Run:

```bash
npm install
```

预期：`package-lock.json` 引用 `apps/host`、`apps/web`、`apps/signal`、`packages/shared`、`packages/transport`、`packages/p2p-core`、`packages/test-utils`，并使用 `@coderelay/*` 包名。

- [ ] **步骤 13：运行聚焦契约测试并确认 GREEN**

Run:

```bash
npm test --workspace @coderelay/shared -- src/coverageConfig.test.ts
```

预期：PASS。

- [ ] **步骤 14：运行新 scaffold 包测试**

Run:

```bash
npm test --workspace @coderelay/signal
npm test --workspace @coderelay/transport
npm test --workspace @coderelay/p2p-core
npm test --workspace @coderelay/test-utils
```

预期：全部 PASS。

- [ ] **步骤 15：提交**

Run:

```bash
git add package.json package-lock.json apps packages
git commit -m "chore: 迁移 workspace 到 CodeRelay 结构"
```

## Task 3: 更新 CI、启动脚本和根文档

**文件：**

- Modify: `packages/shared/src/ciWorkflow.test.ts`
- Modify: `.github/workflows/ci.yml`
- Create: `start-host.bat`
- Modify: `start-server.bat`
- Modify: `start-web.bat`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **步骤 1：先更新 GitHub Actions 契约测试**

将 `packages/shared/src/ciWorkflow.test.ts` 完整替换为：

```typescript
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const thisDir = dirname(fileURLToPath(import.meta.url));
const workflowPath = resolve(thisDir, "../../../.github/workflows/ci.yml");

describe("GitHub Actions CI workflow", () => {
  it("对 develop 与 master 分支的 push / pull_request 触发，并执行 CodeRelay 安装、结构契约、构建、覆盖率校验", () => {
    expect(existsSync(workflowPath)).toBe(true);

    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("name: CodeRelay CI");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches:");
    expect(workflow).toContain("- develop");
    expect(workflow).toContain("- master");

    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm test --workspace @coderelay/shared -- src/coverageConfig.test.ts");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("npm run test:coverage");

    expect(workflow).not.toContain("@cc-web/");
    expect(workflow).not.toContain("packages/server");
    expect(workflow).not.toContain("packages/web");
  });
});
```

- [ ] **步骤 2：运行 CI 契约测试并确认 RED**

Run:

```bash
npm test --workspace @coderelay/shared -- src/ciWorkflow.test.ts
```

预期：FAIL。失败原因应是 `.github/workflows/ci.yml` 仍使用 `name: CI`，且缺少 `npm test --workspace @coderelay/shared -- src/coverageConfig.test.ts`。

- [ ] **步骤 3：更新 `.github/workflows/ci.yml`**

将 `.github/workflows/ci.yml` 完整替换为：

```yaml
name: CodeRelay CI

on:
  push:
    branches:
      - develop
      - master
  pull_request:
    branches:
      - develop
      - master

jobs:
  test-and-build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Verify CodeRelay workspace contract
        run: npm test --workspace @coderelay/shared -- src/coverageConfig.test.ts

      - name: Build
        run: npm run build

      - name: Test with coverage thresholds
        run: npm run test:coverage
```

- [ ] **步骤 4：运行 CI 契约测试并确认 GREEN**

Run:

```bash
npm test --workspace @coderelay/shared -- src/ciWorkflow.test.ts
```

预期：PASS。

- [ ] **步骤 5：创建 `start-host.bat`**

创建 `start-host.bat`：

```bat
@echo off
REM CodeRelay Host startup script (Windows)

echo Starting CodeRelay Host...
echo.

REM Set environment variables
set AUTH_TOKEN=test-token-123456
set PORT=3002
set CLAUDE_PROJECTS_DIR=%USERPROFILE%\.claude\projects
set PERMISSION_MODE=default

echo Configuration:
echo   Port: %PORT%
echo   Auth Token: %AUTH_TOKEN%
echo   Projects Dir: %CLAUDE_PROJECTS_DIR%
echo.

REM Start service
npm run dev:host
```

- [ ] **步骤 6：将 `start-server.bat` 改成兼容包装**

将 `start-server.bat` 完整替换为：

```bat
@echo off
REM Compatibility wrapper. Prefer start-host.bat for CodeRelay Host.

call "%~dp0start-host.bat"
```

- [ ] **步骤 7：更新 `start-web.bat`**

将 `start-web.bat` 完整替换为：

```bat
@echo off
REM CodeRelay Web startup script (Windows)

echo Starting CodeRelay Web...
echo.
echo Web UI will be available at: http://localhost:3000
echo Host API: http://localhost:3002
echo Auth Token: test-token-123456
echo.

npm run dev:web
```

- [ ] **步骤 8：更新 `AGENTS.md` 和 `CLAUDE.md` 的命令与路径**

在两个文件中执行这些精确替换：

```text
cc-web 把本地 Claude Code 的聊天搬上 Web
CodeRelay 把本地 Claude Code 的聊天搬上 Web
```

```text
npm run dev:server   # 启动后端（tsx watch，需要环境变量，见下）
npm run dev:host     # 启动 CodeRelay Host（tsx watch，需要环境变量，见下）
```

```text
npm test --workspace @cc-web/server
npm test --workspace @coderelay/host
```

```text
npm test --workspace @cc-web/web
npm test --workspace @coderelay/web
```

```text
npm test --workspace @cc-web/shared
npm test --workspace @coderelay/shared
```

```text
npm run test:watch --workspace @cc-web/server
npm run test:watch --workspace @coderelay/host
```

```text
cd packages/server && npx vitest run src/jsonl.test.ts
cd apps/host && npx vitest run src/jsonl.test.ts
```

```text
cd packages/server && npx vitest run -t "should parse user messages"
cd apps/host && npx vitest run -t "should parse user messages"
```

```text
`packages/server`
`apps/host`
```

```text
`packages/web`
`apps/web`
```

```text
`@cc-web/server`
`@coderelay/host`
```

```text
`@cc-web/web`
`@coderelay/web`
```

```text
`@cc-web/shared`
`@coderelay/shared`
```

```text
`start-server.bat` / `start-web.bat`
`start-host.bat` / `start-web.bat`（`start-server.bat` 保留为兼容包装）
```

不要替换历史设计文档文件名，例如 `2026-06-14-cc-web-design.md`，那些是已经存在的文件名。

- [ ] **步骤 9：确认根文档不再指向旧 workspace**

Run:

```bash
rg -n "packages/server|packages/web|@cc-web/server|@cc-web/web|@cc-web/shared|dev:server" AGENTS.md CLAUDE.md
```

预期：无匹配，除非新增一句明确说明 `dev:server` 是兼容别名。

- [ ] **步骤 10：确认 CI 和 bat 文件没有旧命名残留**

Run:

```bash
rg -n "@cc-web|packages/server|packages/web|CC-Web|cc-web|dev:server" .github/workflows/ci.yml start-host.bat start-server.bat start-web.bat
```

预期：无匹配，除非 `start-server.bat` 的注释明确表示它是兼容 wrapper，或根脚本保留 `dev:server` 兼容别名。

- [ ] **步骤 11：提交**

Run:

```bash
git add .github/workflows/ci.yml packages/shared/src/ciWorkflow.test.ts start-host.bat start-server.bat start-web.bat AGENTS.md CLAUDE.md
git commit -m "ci: 更新 CodeRelay CI 与启动脚本"
```

## Task 4: 全量验证

**文件：**

- 无计划文件编辑。

- [ ] **步骤 1：运行全部测试**

Run:

```bash
npm test
```

预期：所有 workspace test suites PASS。

- [ ] **步骤 2：运行全量构建**

Run:

```bash
npm run build
```

预期：所有 workspaces 构建成功，包括 `@coderelay/host`、`@coderelay/web`、`@coderelay/shared`、`@coderelay/signal`、`@coderelay/transport`、`@coderelay/p2p-core`、`@coderelay/test-utils`。

- [ ] **步骤 3：检查旧包名残留**

Run:

```bash
rg -n "@cc-web/shared|@cc-web/server|@cc-web/web" apps packages package.json package-lock.json
```

预期：无匹配。

- [ ] **步骤 4：检查 Git 状态**

Run:

```bash
git status --short
```

预期：工作区干净。

如果构建或测试生成文件导致工作区变脏，先检查内容。不要回滚无关用户改动。如果只有本计划产生的 lockfile 或 workspace metadata 变更，把它们归入对应任务提交。

## 自审记录

Spec 覆盖：

- 覆盖 `packages/server` 与 `packages/web` 迁移到 `apps/host` 和 `apps/web`。
- 覆盖包名从 `@cc-web/*` 改为 `@coderelay/*`。
- 覆盖 Signal、Transport、P2P Core、Test Utils 的未来 workspace scaffold。
- 覆盖 `.github/workflows/ci.yml` 的 CodeRelay CI 命名和 workspace contract 校验。
- 覆盖 `start-host.bat`、`start-server.bat`、`start-web.bat` 的 CodeRelay 启动脚本迁移。
- 通过保留 Host/Web 行为不变来保留现有 HTTP 模式。
- 明确将 Transport 抽象、设备身份、Signal 行为、WebRTC 和 TURN 留给后续独立计划。

类型一致性：

- 包名统一使用 `@coderelay/*`。
- app 路径统一使用 `apps/host`、`apps/web`、`apps/signal`。
- shared 路径保持 `packages/shared`。
- 兼容脚本 `dev:server` 委托到 `dev:host`。
