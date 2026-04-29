import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isPackageFile,
  isActionFile,
  isFileDependencyUpdate,
  isDependencyUpdate,
  getPageOfFiles,
} from "../../src/lib/filecheck.js";
import type { HttpClient } from "@actions/http-client";
import { error } from "node:console";

// ---------------------------------------------------------------------------
// Mock @actions/http-client
// ---------------------------------------------------------------------------

const mockHttp = vi.hoisted(() => {
  const dispose = vi.fn();
  const readBody = vi.fn<() => Promise<string>>();
  const message = { statusCode: 200 };
  const response = { readBody, message };
  const get = vi
    .fn<
      (
        url: string,
        headers?: Record<string, string>,
      ) => Promise<typeof response>
    >()
    .mockResolvedValue(response);

  return { dispose, readBody, message, response, get };
});

vi.mock("@actions/http-client", () => ({
  HttpClient: vi.fn().mockImplementation(function () {
    return {
      get: mockHttp.get,
      dispose: mockHttp.dispose,
    };
  }),
}));

function makeResponse(
  statusCode: number,
  body: string,
  headers: Record<string, string | string[]> = {},
) {
  return {
    message: { statusCode, headers },
    readBody: vi.fn<() => Promise<string>>().mockResolvedValue(body),
  };
}

// ---------------------------------------------------------------------------
// isPackageFile
// ---------------------------------------------------------------------------

describe("isPackageFile", () => {
  it.each([
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "Gemfile",
    "Gemfile.lock",
    "go.mod",
    "Cargo.toml",
    "Cargo.lock",
    "composer.json",
    "composer.lock",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "Pipfile",
    "Pipfile.lock",
    "setup.py",
    "pyproject.toml",
    "poetry.lock",
    "uv.lock",
    "nuget.config",
    "packages.config",
    "pubspec.yaml",
    "pubspec.lock",
  ])("should return true for %s", (filename: string) => {
    expect(isPackageFile(filename)).toBe(true);
  });

  it("should return true for requirements.txt", () => {
    expect(isPackageFile("requirements.txt")).toBe(true);
  });

  it("should return true for requirements-dev.txt", () => {
    expect(isPackageFile("requirements-dev.txt")).toBe(true);
  });

  it("should return true for requirements_test.txt", () => {
    expect(isPackageFile("requirements_test.txt")).toBe(true);
  });

  it("should return true for a .gemspec file", () => {
    expect(isPackageFile("my-gem.gemspec")).toBe(true);
  });

  it("should return true for a .csproj file", () => {
    expect(isPackageFile("MyApp.csproj")).toBe(true);
  });

  it("should return true for a .fsproj file", () => {
    expect(isPackageFile("MyLib.fsproj")).toBe(true);
  });

  it("should return true for a .vbproj file", () => {
    expect(isPackageFile("MyApp.vbproj")).toBe(true);
  });

  it("should return true for a nested path like deps/package.json", () => {
    expect(isPackageFile("deps/package.json")).toBe(true);
  });

  it("should return true for a deeply nested path like a/b/c/go.mod", () => {
    expect(isPackageFile("a/b/c/go.mod")).toBe(true);
  });

  it("should return false for a TypeScript source file", () => {
    expect(isPackageFile("src/index.ts")).toBe(false);
  });

  it("should return false for a workflow YAML file", () => {
    expect(isPackageFile(".github/workflows/ci.yml")).toBe(false);
  });
  it("should return false for a README", () => {
    expect(isPackageFile("README.md")).toBe(false);
  });

  it("should return false for a file named requirements-notes.md", () => {
    expect(isPackageFile("requirements-notes.md")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isActionFile
// ---------------------------------------------------------------------------

describe("isActionFile", () => {
  it("should return true for a file inside .github/workflows/", () => {
    expect(isActionFile(".github/workflows/ci.yml")).toBe(true);
  });

  it("should return true for a file inside .github/actions/", () => {
    expect(isActionFile(".github/actions/my-action/action.yml")).toBe(true);
  });

  it("should return true for a nested file deep in .github/workflows/", () => {
    expect(isActionFile(".github/workflows/sub/deploy.yaml")).toBe(true);
  });

  it("should return false for a file in .github/ but not actions or workflows", () => {
    expect(isActionFile(".github/CODEOWNERS")).toBe(false);
  });

  it("should return false for a package file", () => {
    expect(isActionFile("package.json")).toBe(false);
  });

  it("should return false for a source file", () => {
    expect(isActionFile("src/index.ts")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isFileDependencyUpdate
// ---------------------------------------------------------------------------

describe("isFileDependencyUpdate", () => {
  it("should return true for a package file", () => {
    expect(isFileDependencyUpdate("package.json")).toBe(true);
  });

  it("should return true for a lock file", () => {
    expect(isFileDependencyUpdate("yarn.lock")).toBe(true);
  });

  it("should return true for a workflow file", () => {
    expect(isFileDependencyUpdate(".github/workflows/ci.yml")).toBe(true);
  });

  it("should return true for an action definition file", () => {
    expect(isFileDependencyUpdate(".github/actions/my-action/action.yml")).toBe(
      true,
    );
  });

  it("should return false for a source file", () => {
    expect(isFileDependencyUpdate("src/index.ts")).toBe(false);
  });

  it("should return false for a README", () => {
    expect(isFileDependencyUpdate("README.md")).toBe(false);
  });

  it("should return false for a file in .github/ outside actions and workflows", () => {
    expect(isFileDependencyUpdate(".github/CODEOWNERS")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getPageOfFiles
// ---------------------------------------------------------------------------

describe("getPageOfFiles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should request the correct API URL", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, "[]"));
    await getPageOfFiles(mockHttp as unknown as HttpClient, "url", {
      "Mock-Header": "value",
    });

    const [url] = mockHttp.get.mock.calls[0] as [string];
    expect(url).toBe("url");
  });

  it("should include call the API with provided headers", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, "[]"));

    await getPageOfFiles(mockHttp as unknown as HttpClient, "url", {
      "Mock-Header": "value",
    });

    const [, headers] = mockHttp.get.mock.calls[0] as [
      string,
      Record<string, string>,
    ];
    expect(headers["Mock-Header"]).toBe("value");
  });

  it("should return the list of filenames from the API response", async () => {
    const files = [
      { filename: "package.json", status: "modified" },
      { filename: "src/index.ts", status: "added" },
    ];
    mockHttp.get.mockResolvedValueOnce(
      makeResponse(200, JSON.stringify(files)),
    );
    const result = await getPageOfFiles(
      mockHttp as unknown as HttpClient,
      "url",
      { "Mock-Header": "value " },
    );
    expect(result).toEqual({
      files: ["package.json", "src/index.ts"],
      hasNextPage: false,
    });
  });

  it("should return hasNextPage false if link is empty", async () => {
    const files = [
      { filename: "package.json", status: "modified" },
      { filename: "src/index.ts", status: "added" },
    ];
    const repsonseHeaders = { link: "" };
    mockHttp.get.mockResolvedValueOnce(
      makeResponse(200, JSON.stringify(files), repsonseHeaders),
    );
    const result = await getPageOfFiles(
      mockHttp as unknown as HttpClient,
      "url",
      { "Mock-Header": "value " },
    );
    expect(result).toEqual({
      files: ["package.json", "src/index.ts"],
      hasNextPage: false,
    });
  });

  it("should return hasNextPage false if link doesn't contain next", async () => {
    const files = [
      { filename: "package.json", status: "modified" },
      { filename: "src/index.ts", status: "added" },
    ];
    const repsonseHeaders = {
      link: '<https://api.github.com/.../files?page=2>; rel="prev"',
    };
    mockHttp.get.mockResolvedValueOnce(
      makeResponse(200, JSON.stringify(files), repsonseHeaders),
    );
    const result = await getPageOfFiles(
      mockHttp as unknown as HttpClient,
      "url",
      { "Mock-Header": "value " },
    );
    expect(result).toEqual({
      files: ["package.json", "src/index.ts"],
      hasNextPage: false,
    });
  });

  it("should return hasNextPage false if header doesn't contain link", async () => {
    const files = [
      { filename: "package.json", status: "modified" },
      { filename: "src/index.ts", status: "added" },
    ];
    const repsonseHeaders = { otherHeader: "value" };
    mockHttp.get.mockResolvedValueOnce(
      makeResponse(200, JSON.stringify(files), repsonseHeaders),
    );
    const result = await getPageOfFiles(
      mockHttp as unknown as HttpClient,
      "url",
      { "Mock-Header": "value " },
    );
    expect(result).toEqual({
      files: ["package.json", "src/index.ts"],
      hasNextPage: false,
    });
  });

  it("should return hasNextPage true if link contains next", async () => {
    const files = [
      { filename: "package.json", status: "modified" },
      { filename: "src/index.ts", status: "added" },
    ];
    const repsonseHeaders = {
      link: '<https://api.github.com/.../files?page=2>; rel="next"',
    };
    mockHttp.get.mockResolvedValueOnce(
      makeResponse(200, JSON.stringify(files), repsonseHeaders),
    );
    const result = await getPageOfFiles(
      mockHttp as unknown as HttpClient,
      "url",
      { "Mock-Header": "value " },
    );
    expect(result).toEqual({
      files: ["package.json", "src/index.ts"],
      hasNextPage: true,
    });
  });

  it("should throw when the API returns a non-2xx status", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(403, "Forbidden"));

    await getPageOfFiles(mockHttp as unknown as HttpClient, "url", {}).catch(
      (e) => {
        expect(e).toEqual(
          new Error("GitHub API error listing PR files: HTTP 403"),
        );
      },
    );
    expect(mockHttp.get).toHaveBeenCalledOnce();
  });

});

// ---------------------------------------------------------------------------
// isDependencyUpdate
// ---------------------------------------------------------------------------
describe("isDependencyUpdate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return true if the first page of files contains a dependency update", async () => {
    const files = [
      { filename: "package.json", status: "modified" },
      { filename: "src/index.ts", status: "added" },
    ];
    mockHttp.get.mockResolvedValueOnce(
      makeResponse(200, JSON.stringify(files)),
    );

    const result = await isDependencyUpdate("token", "org", "repo", 1);
    expect(result).toBe(true);
    expect(mockHttp.get).toHaveBeenCalledTimes(1);
  });


  it("should return true if a later page of files contains a dependency update", async () => {
    const page1Files = [
      { filename: "index.js", status: "modified" },
      { filename: "src/index.ts", status: "added" },
    ];
    const page2Files = [{ filename: "package.json", status: "modified" }];
    mockHttp.get
      .mockResolvedValueOnce(
        makeResponse(200, JSON.stringify(page1Files), {
          link: '<https://api.github.com/.../files?page=2>; rel="next"',
        }),
      )
      .mockResolvedValueOnce(makeResponse(200, JSON.stringify(page2Files)));
    const result = await isDependencyUpdate("token", "org", "repo", 1);
    expect(result).toBe(true);
    expect(mockHttp.get).toHaveBeenCalledTimes(2);
  });

  it("should return false if no pages contain a dependency update", async () => {
    const page1Files = [
      { filename: "index.js", status: "modified" },
      { filename: "src/index.ts", status: "added" },
    ];
    const page2Files = [{ filename: "README.md", status: "modified" }];
    mockHttp.get
      .mockResolvedValueOnce(
        makeResponse(200, JSON.stringify(page1Files), {
          link: '<https://api.github.com/.../files?page=2>; rel="next"',
        }),
      )
      .mockResolvedValueOnce(makeResponse(200, JSON.stringify(page2Files)));
    const result = await isDependencyUpdate("token", "org", "repo", 1);
    expect(result).toBe(false);
    expect(mockHttp.get).toHaveBeenCalledTimes(2);
  });

  it("should return false if there are no files at all", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, JSON.stringify([])));
    const result = await isDependencyUpdate("token", "org", "repo", 1);
    expect(result).toBe(false);
    expect(mockHttp.get).toHaveBeenCalledTimes(1);
  });

  it("should stop after 30 pages of results", async () => {
    const files = [{ filename: "index.js", status: "modified" }];
    const link = '<https://api.github.com/.../files?page=2>; rel="next"';
    for (let i = 0; i < 29; i++) {
      mockHttp.get.mockResolvedValueOnce(
        makeResponse(200, JSON.stringify(files), { link }),
      );
    }
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, JSON.stringify(files), {link: ""}));

    const result = await isDependencyUpdate("token", "org", "repo", 1);
    expect(result).toBe(false);
    expect(mockHttp.get).toHaveBeenCalledTimes(30);
  });

  it("should throw if the API returns a non-2xx status", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(403, "Forbidden"));

    await isDependencyUpdate("token", "org", "repo", 1).catch((e) => {
      expect(e).toEqual(
        new Error("GitHub API error listing PR files: HTTP 403"),
      );
    });
    expect(mockHttp.get).toHaveBeenCalledTimes(1);
  });

  it("should throw if there are more than 3000 files", async () => {
    const files = [{ filename: "index.js", status: "modified" }];
    const link = '<https://api.github.com/.../files?page=2>; rel="next"';
    for (let i = 0; i < 30; i++) {
      mockHttp.get.mockResolvedValueOnce(
        makeResponse(200, JSON.stringify(files), { link }),
      );
    }
    await isDependencyUpdate("token", "org", "repo", 1).catch((e) => {
      expect(e).toEqual(
        new Error(
          "PR #1 has more than 3000 changed files, which exceeds the maximum that can be checked for dependency updates.",
        ),
      );
    });
    expect(mockHttp.get).toHaveBeenCalledTimes(30);
  });

  it("should dispose the HttpClient after use, even if there is an error", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(403, "Forbidden"));

    await isDependencyUpdate("token", "org", "repo", 1).catch(() => {
      // ignore error
    });
    expect(mockHttp.dispose).toHaveBeenCalledTimes(1);
  });

    it("should dispose the HttpClient after use", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, JSON.stringify([])));

    await isDependencyUpdate("token", "org", "repo", 1)
    expect(mockHttp.dispose).toHaveBeenCalledTimes(1);
  });

});
