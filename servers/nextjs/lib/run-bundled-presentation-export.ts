import path from "path";
import os from "os";
import fs from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { sanitizeFilename } from "@/app/(presentation-generator)/utils/others";
import {
  BoundedTextBuffer,
  memorySnapshotMb,
} from "@/lib/runtime-limits";

/** Repo `presentation-export/` at app root (`/app/presentation-export` in Docker). */
export function getExportPackageRoot(): string {
  return (
    process.env.EXPORT_PACKAGE_ROOT?.trim() ||
    path.join(process.cwd(), "..", "..", "presentation-export")
  );
}

export function getPresentonAppRoot(): string {
  return (
    process.env.PRESENTON_APP_ROOT?.trim() ||
    path.join(process.cwd(), "..", "..")
  );
}

export function getAppDataDirectory(): string {
  const envVal = process.env.APP_DATA_DIRECTORY?.trim();
  if (envVal) return envVal;

  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "presenton"
    );
  }
  return "/app/user_data";
}


function extractSessionTokenFromCookieHeader(cookieHeader?: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const match = cookieHeader.match(/(?:^|;\s*)presenton_session=([^;]+)/);
  if (!match?.[1]) {
    return undefined;
  }

  return decodeURIComponent(match[1]);
}

async function resolveExportEntrypoint(exportRoot: string): Promise<string> {
  const indexCjs = path.join(exportRoot, "index.cjs");
  const indexJs = path.join(exportRoot, "index.js");

  try {
    await fs.access(indexCjs);
    return indexCjs;
  } catch {
    await fs.access(indexJs);
    await fs.copyFile(indexJs, indexCjs);
    return indexCjs;
  }
}

function bundledConverterPath(exportRoot: string): string {
  const fromEnv = process.env.BUILT_PYTHON_MODULE_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return path.join(exportRoot, "py", "convert-linux-x64");
  }
  if (process.platform === "win32" && process.arch === "x64") {
    const candidates = [
      path.join(exportRoot, "py", "convert-win32-x64.exe"),
      path.join(exportRoot, "py", "convert-win32.exe"),
      path.join(exportRoot, "py", "convert.exe"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return candidates[0];
  }
  throw new Error(
    `No bundled export converter for ${process.platform}/${process.arch}. Set BUILT_PYTHON_MODULE_PATH.`
  );
}

export async function bundledExportPackageAvailable(): Promise<boolean> {
  try {
    const root = getExportPackageRoot();
    await resolveExportEntrypoint(root);
    await fs.access(bundledConverterPath(root));
    return true;
  } catch {
    return false;
  }
}

export type BundledPresentationExportFormat = "pdf" | "pptx";

export type BundledPresentationExportResult = { path: string };

const EXPORT_DIRECTORY_MODE = 0o755;
const EXPORT_FILE_MODE = 0o644;

function normalizeExportOutputPath(params: {
  pathValue?: string;
  urlValue?: string;
}): string {
  const { pathValue, urlValue } = params;
  const appData = getAppDataDirectory();

  const resolveAppDataRelative = (value: string): string => {
    if (!appData) {
      throw new Error("APP_DATA_DIRECTORY is required for relative export paths.");
    }

    const normalized = value.startsWith("/") ? value.slice(1) : value;
    if (!normalized.startsWith("app_data/")) {
      return path.join(appData, normalized);
    }
    return path.join(appData, normalized.slice("app_data/".length));
  };

  if (pathValue && typeof pathValue === "string") {
    if (path.isAbsolute(pathValue)) {
      return pathValue;
    }
    return resolveAppDataRelative(pathValue);
  }

  if (urlValue && typeof urlValue === "string") {
    if (urlValue.startsWith("file://")) {
      if (urlValue.includes("/app_data/")) {
        const relativePart = urlValue.substring(urlValue.indexOf("/app_data/") + "/app_data/".length);
        return resolveAppDataRelative(relativePart);
      }
      try {
        return fileURLToPath(urlValue);
      } catch {
        const parsed = new URL(urlValue);
        let fsPath = decodeURIComponent(parsed.pathname || "");
        if (process.platform === "win32" && fsPath.startsWith("/") && fsPath.charAt(2) === ":") {
          fsPath = fsPath.slice(1);
        }
        if (path.isAbsolute(fsPath)) {
          return fsPath;
        }
        return resolveAppDataRelative(fsPath);
      }
    }

    if (urlValue.startsWith("/app_data/")) {
      return resolveAppDataRelative(urlValue);
    }
  }

  throw new Error("Export finished but response did not include a valid output path.");
}

async function ensureExportFileReadable(filePath: string): Promise<void> {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) {
    throw new Error("Export finished but output path is not a file.");
  }

  await fs.chmod(path.dirname(filePath), EXPORT_DIRECTORY_MODE);
  await fs.chmod(filePath, EXPORT_FILE_MODE);
}

/**
 * Runs the bundled export entrypoint (`presentation-export/index.js`) with
 * `BUILT_PYTHON_MODULE_PATH` pointing at the PyInstaller converter binary.
 */
export async function runBundledPresentationExport(params: {
  presentationId: string;
  title: string | undefined;
  format: BundledPresentationExportFormat;
  cookieHeader?: string;
}): Promise<BundledPresentationExportResult> {
  return runBundledPresentationExportLocked(params);
}

async function runBundledPresentationExportLocked(params: {
  presentationId: string;
  title: string | undefined;
  format: BundledPresentationExportFormat;
  cookieHeader?: string;
}): Promise<BundledPresentationExportResult> {
  const { presentationId, title, format, cookieHeader } = params;
  const exportRoot = getExportPackageRoot();
  const entrypoint = await resolveExportEntrypoint(exportRoot);
  const converter = bundledConverterPath(exportRoot);
  const appRoot = getPresentonAppRoot();

  await fs.access(converter);

  const nextjsUrl =
    process.env.NEXT_PUBLIC_URL?.trim() || "http://127.0.0.1:3000";
  const q = new URLSearchParams({ id: presentationId });
  const sessionToken = extractSessionTokenFromCookieHeader(cookieHeader);
  if (sessionToken) {
    q.set("exportSession", sessionToken);
  }
  const fastapiUrl = process.env.NEXT_PUBLIC_FAST_API?.trim();
  if (fastapiUrl) {
    q.set("fastapiUrl", fastapiUrl);
  }
  const basePptUrl = `${nextjsUrl}/pdf-maker?${q.toString()}`;
  const pptUrl = cookieHeader?.trim()
    ? `${basePptUrl}#exportCookie=${encodeURIComponent(cookieHeader)}`
    : basePptUrl;

  const tempBase =
    process.env.TEMP_DIRECTORY?.trim() || path.join(os.tmpdir(), "presenton");
  await fs.mkdir(tempBase, { recursive: true });
  const workDir = await fs.mkdtemp(path.join(tempBase, "export-"));
  const exportTaskPath = path.join(workDir, "export_task.json");

  const exportTask = {
    type: "export",
    url: pptUrl,
    format,
    title: sanitizeFilename(title ?? "presentation"),
    fastapiUrl: fastapiUrl || undefined,
    cookieHeader: cookieHeader || undefined,
  };

  try {
    await fs.writeFile(exportTaskPath, JSON.stringify(exportTask), "utf8");

    const responsePath = exportTaskPath.replace(/\.json$/i, ".response.json");

    console.info("[bundled-export] start", {
      presentationId,
      format,
      memory: memorySnapshotMb(),
    });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [entrypoint, exportTaskPath], {
        cwd: appRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          BUILT_PYTHON_MODULE_PATH: converter,
          APP_DATA_DIRECTORY: getAppDataDirectory(),
        },
      });
      const stderr = new BoundedTextBuffer();
      const stdout = new BoundedTextBuffer();
      const onStderrData = (d: Buffer) => stderr.append(d);
      const onStdoutData = (d: Buffer) => stdout.append(d);
      let settled = false;
      const cleanup = () => {
        child.stderr?.removeListener("data", onStderrData);
        child.stdout?.removeListener("data", onStdoutData);
        child.removeListener("error", onError);
        child.removeListener("close", onClose);
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const onError = (error: Error) => finish(() => reject(error));
      const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
        console.info("[bundled-export] child exit", {
          presentationId,
          format,
          pid: child.pid,
          code,
          signal,
          memory: memorySnapshotMb(),
        });
        if (code === 0) {
          finish(resolve);
        } else {
          const errText = stderr.toString();
          const outText = stdout.toString();
          finish(() => {
            reject(
              new Error(
                `Export process exited with code ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}${errText ? `. ${errText}` : ""}${outText ? ` stdout: ${outText}` : ""}`
              )
            );
          });
        }
      };
      child.stderr?.on("data", onStderrData);
      child.stdout?.on("data", onStdoutData);
      child.once("error", onError);
      child.once("close", onClose);
    });

    const responseRaw = await fs.readFile(responsePath, "utf8");
    const responseData = JSON.parse(responseRaw) as { path?: string; url?: string };

    const outPath = normalizeExportOutputPath({
      pathValue: responseData?.path,
      urlValue: responseData?.url,
    });

    await ensureExportFileReadable(outPath);
    console.info("[bundled-export] finish", {
      presentationId,
      format,
      memory: memorySnapshotMb(),
    });

    return { path: outPath };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
