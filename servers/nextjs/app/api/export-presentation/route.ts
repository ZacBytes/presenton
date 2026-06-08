import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { sanitizeFilename } from "@/app/(presentation-generator)/utils/others";
import { generateVectorPptx } from "@/lib/pptx-generator";
import {
  BundledPresentationExportFormat,
  bundledExportPackageAvailable,
  runBundledPresentationExport,
  getAppDataDirectory,
} from "@/lib/run-bundled-presentation-export";

function isValidFormat(value: unknown): value is string {
  return value === "pdf" || value === "pptx" || value === "pptx_vector";
}

function getFastApiBaseUrl(): string {
  const internal = process.env.FAST_API_INTERNAL_URL?.trim();
  if (internal) {
    return internal.replace(/\/+$/, "");
  }

  const configured = process.env.NEXT_PUBLIC_FAST_API?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  return "http://127.0.0.1:8000";
}

function buildExportDownloadUrl(outPath: string): string {
  const appDataDirectory = getAppDataDirectory();

  const exportsDirectory = path.join(appDataDirectory, "exports");
  const relativePath = path.relative(exportsDirectory, outPath);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Export finished outside the configured exports directory.");
  }

  return `/api/export-presentation/file?name=${encodeURIComponent(relativePath)}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { format, id, title, slidesData } = body;
  const cookieHeader = req.headers.get("cookie") ?? "";

  if (!id) {
    return NextResponse.json(
      { error: "Missing Presentation ID" },
      { status: 400 }
    );
  }

  if (!isValidFormat(format)) {
    return NextResponse.json(
      { error: "Invalid export format" },
      { status: 400 }
    );
  }

  try {
    const appDataDirectory = getAppDataDirectory();

    if (format === "pptx" || format === "pptx_vector") {
      if (!slidesData) {
        throw new Error("Missing slidesData for PPTX export");
      }

      // Generate the vector PowerPoint presentation buffer
      const pptxBuffer = await generateVectorPptx(slidesData, getFastApiBaseUrl());

      // Save to exports directory
      const exportsDirectory = path.join(appDataDirectory, "exports");
      await fs.promises.mkdir(exportsDirectory, { recursive: true });
      const fileName = `${sanitizeFilename(title ?? "presentation")}-${uuidv4()}.pptx`;
      const outPath = path.join(exportsDirectory, fileName);
      
      await fs.promises.writeFile(outPath, pptxBuffer);

      return NextResponse.json({
        success: true,
        path: buildExportDownloadUrl(outPath),
      });
    }

    // Fallback to Puppeteer-based PDF export
    if (!(await bundledExportPackageAvailable())) {
      throw new Error(
        "presentation-export runtime is not available. Run scripts/sync-presentation-export.cjs to install it."
      );
    }

    const { path: outPath } = await runBundledPresentationExport({
      format: format as BundledPresentationExportFormat,
      presentationId: id,
      title,
      cookieHeader,
    });

    return NextResponse.json({
      success: true,
      path: buildExportDownloadUrl(outPath),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[export-presentation:${format}]`, message);
    return NextResponse.json(
      { error: message, success: false },
      { status: 500 }
    );
  }
}

