import pptxgen from "pptxgenjs";
import fs from "fs";
import path from "path";

/**
 * Resolves an image URL to a local filesystem path if possible and reads it,
 * encoding it to a base64 Data URL to bypass Node.js pptxgenjs protocol issues on HTTP.
 */
export async function resolveImageToBase64(
  imageUrl: string,
  fastApiBaseUrl: string
): Promise<{ data: string } | { path: string }> {
  if (!imageUrl) return { path: imageUrl };

  let localPath = "";
  const appDataDir = process.env.APP_DATA_DIRECTORY?.trim();

  // Normalize URL/path
  let cleanUrl = imageUrl;
  if (imageUrl.startsWith("/")) {
    cleanUrl = `${fastApiBaseUrl.replace(/\/+$/, "")}${imageUrl}`;
  }

  // Determine if it points to local static or app_data
  let relativePath = imageUrl;
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    try {
      const parsed = new URL(imageUrl);
      relativePath = parsed.pathname;
    } catch {
      // Ignore
    }
  }

  if (relativePath.startsWith("/static/")) {
    // Resolve to servers/fastapi/static/...
    localPath = path.join(process.cwd(), "..", "fastapi", relativePath);
  } else if (relativePath.startsWith("/app_data/")) {
    if (appDataDir) {
      localPath = path.join(appDataDir, relativePath.substring("/app_data/".length));
    }
  }

  if (localPath) {
    try {
      if (fs.existsSync(localPath)) {
        const fileBuffer = await fs.promises.readFile(localPath);
        const ext = path.extname(localPath).toLowerCase().replace(".", "");
        const mime = ext === "png" ? "image/png" : "image/jpeg";
        return { data: `data:${mime};base64,${fileBuffer.toString("base64")}` };
      }
    } catch (e) {
      console.error(`[resolveImageToBase64] Failed to read local file: ${localPath}`, e);
    }
  }

  // Fallback to fetch via http/https
  if (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://")) {
    try {
      const res = await fetch(cleanUrl);
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = res.headers.get("content-type") || "image/jpeg";
        return { data: `data:${contentType};base64,${buffer.toString("base64")}` };
      }
    } catch (e) {
      console.error(`[resolveImageToBase64] Failed to fetch url: ${cleanUrl}`, e);
    }
  }

  return { path: cleanUrl };
}

/**
 * Compiles a high-fidelity DOM-to-Vector slide layout into a native PowerPoint file.
 * Absolutely zero hardcoded styling or layout rules are contained here.
 */
export async function generateVectorPptx(
  slidesData: any[],
  fastApiBaseUrl: string = "http://127.0.0.1:8000"
): Promise<Buffer> {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_16x9"; // 10 x 5.625 inches
  
  for (const slideData of slidesData) {
    const slide = pptx.addSlide();
    slide.background = { color: slideData.bgColor };
    
    if (slideData.speakerNote) {
      slide.addNotes(slideData.speakerNote);
    }
    
    for (const el of slideData.elements) {
      if (el.type === "text") {
        slide.addText(el.text, {
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          fontSize: el.fontSize,
          color: el.color,
          bold: el.bold,
          italic: el.italic,
          align: el.align,
          fontFace: el.fontFace,
          valign: "top"
        });
      } else if (el.type === "image") {
        try {
          const resolvedImage = await resolveImageToBase64(el.src, fastApiBaseUrl);
          slide.addImage({
            ...resolvedImage,
            x: el.x,
            y: el.y,
            w: el.w,
            h: el.h
          });
        } catch (err) {
          console.error("Failed to add image to PPTX slide", err);
        }
      } else if (el.type === "shape") {
        const shapeType = el.shapeType === "diamond" ? pptx.ShapeType.diamond : pptx.ShapeType.rect;
        slide.addShape(shapeType, {
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          fill: { color: el.fill },
          line: el.border ? { color: el.border.color, width: el.border.width } : undefined
        });
      }
    }
  }
  
  const buffer = await pptx.write({ outputType: "nodebuffer" });
  return buffer as Buffer;
}
