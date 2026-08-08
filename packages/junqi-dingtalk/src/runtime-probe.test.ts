import assert from "node:assert/strict";
import test from "node:test";
import { projectDwsCurrentUser, projectDwsProfiles, probeDwsRuntime } from "./runtime-probe.js";

test("projects the current DWS profile and authorization metadata", () => {
  assert.deepEqual(projectDwsProfiles({
    currentProfile: "corp-a:user-a",
    profiles: [{
      profile: "corp-a:user-a",
      corpId: "corp-a",
      corpName: "示例组织",
      userId: "user-a",
      userName: "张三",
      status: "active",
      authorizedDomains: ["contact", "calendar"],
      expiresAt: "2026-08-09T00:00:00Z",
    }],
  }), [{
    profile: "corp-a:user-a",
    corpId: "corp-a",
    corpName: "示例组织",
    userId: "user-a",
    userName: "张三",
    status: "active",
    authorizedDomains: ["contact", "calendar"],
    expiresAt: "2026-08-09T00:00:00Z",
    isCurrent: true,
  }]);
});

test("projects only safe current-user fields and accepts HTTPS avatars", () => {
  assert.deepEqual(projectDwsCurrentUser({
    result: [{
      orgEmployeeModel: {
        orgUserName: "张三",
        userId: "user-a",
        orgName: "示例组织",
        deptName: "产品部",
        avatarUrl: "https://example.invalid/avatar.png",
        mobile: "13800000000",
      },
    }],
  }), {
    name: "张三",
    userId: "user-a",
    organization: "示例组织",
    department: "产品部",
    avatarUrl: "https://example.invalid/avatar.png",
  });
  assert.equal(projectDwsCurrentUser({ result: [{ orgEmployeeModel: { avatar: "file-id-only" } }] }), null);
});

test("reports an unavailable DWS executable without claiming a successful probe", async () => {
  const runtime = await probeDwsRuntime({
    resolveExecutable: async () => { throw new Error("missing executable"); },
  } as never);
  assert.equal(runtime.available, false);
  assert.equal((runtime.runtimeError as { code?: string }).code, "DWS_RUNTIME_FAILURE");
});
