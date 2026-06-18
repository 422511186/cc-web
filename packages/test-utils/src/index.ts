export interface TestUtilsScaffold {
  readonly packageName: "@coderelay/test-utils";
}

export function createTestUtilsScaffold(): TestUtilsScaffold {
  return { packageName: "@coderelay/test-utils" };
}
