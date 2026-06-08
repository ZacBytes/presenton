"use client";
import { Button } from "@/components/ui/button";
import {
  Play,
  Loader2,
  Redo2,
  Undo2,
  RotateCcw,
  ArrowRightFromLine,
  ArrowUpRight,
  Pencil,
  Check,
  X,
  AlertTriangle,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PresentationGenerationApi } from "../../services/api/presentation-generation";
import { useDispatch, useSelector } from "react-redux";

import { RootState } from "@/store/store";
import { notify } from "@/components/ui/sonner";
import { trackEvent, MixpanelEvent } from "@/utils/mixpanel";
import { usePresentationUndoRedo } from "../hooks/PresentationUndoRedo";
import ToolTip from "@/components/ToolTip";
import {
  clearPresentationData,
  updateTitle,
} from "@/store/slices/presentationGeneration";
import { clearHistory } from "@/store/slices/undoRedoSlice";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ThemeSelector from "./ThemeSelector";
import { DEFAULT_THEMES } from "../../(dashboard)/theme/components/ThemePanel/constants";
import ThemeApi from "../../services/api/theme";
import { Theme } from "../../services/api/types";
import MarkdownRenderer from "@/components/MarkDownRender";
import { cn } from "@/lib/utils";

const MAX_EXPORT_TITLE_LENGTH = 40;

const buildSafeExportFileName = (
  rawTitle: string | null | undefined,
  extension: "pdf" | "pptx"
) => {
  const normalizedTitle = (rawTitle || "presentation").trim();
  const titleWithoutExtension = normalizedTitle.replace(/\.(pdf|pptx)$/i, "");

  let safeBase = titleWithoutExtension
    // Replace all punctuation/special chars (including dots) with dashes
    .replace(/[^a-zA-Z0-9\s_-]+/g, "-")
    // Replace whitespace with single dashes
    .replace(/\s+/g, "-")
    // Collapse repeated separators
    .replace(/[-_]{2,}/g, "-")
    // Trim separators from both ends
    .replace(/^[-_]+|[-_]+$/g, "");

  if (!safeBase) {
    safeBase = "presentation";
  }

  if (safeBase.length > MAX_EXPORT_TITLE_LENGTH) {
    safeBase = safeBase
      .slice(0, MAX_EXPORT_TITLE_LENGTH)
      .replace(/[-_]+$/g, "");
  }

  if (!safeBase) {
    safeBase = "presentation";
  }

  return `${safeBase}.${extension}`;
};

const PresentationHeader = ({
  presentation_id,
  isPresentationSaving,
  currentSlide,
}: {
  presentation_id: string;
  isPresentationSaving: boolean;
  currentSlide?: number;
}) => {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [isExporting, setIsExporting] = useState(false);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isRegenerateConfirmOpen, setIsRegenerateConfirmOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  /** Avoid committing on blur when Save/Cancel was used (focus/click ordering) */
  const titleBlurIntentRef = useRef<"none" | "save" | "cancel">("none");

  const pathname = usePathname();
  const dispatch = useDispatch();

  const { presentationData, isStreaming } = useSelector(
    (state: RootState) => state.presentationGeneration
  );

  useEffect(() => {
    const load = async () => {
      try {
        const [customThemes] = await Promise.all([ThemeApi.getThemes()]);
        setThemes([...customThemes, ...DEFAULT_THEMES]);
      } catch (e: any) {
        notify.error("Could not load themes", e?.message || "Failed to load themes.");
      }
    };
    if (themes.length === 0) {
      load();
    }
  }, []);

  const { onUndo, onRedo, canUndo, canRedo } = usePresentationUndoRedo();

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const beginTitleEdit = () => {
    if (isStreaming || !presentationData) return;
    setDraftTitle(presentationData.title || "");
    setIsEditingTitle(true);
  };

  const commitTitleEdit = () => {
    if (!presentationData) {
      setIsEditingTitle(false);
      return;
    }
    const trimmed = draftTitle.trim();
    const next = trimmed || presentationData.title || "Presentation";
    if (next !== presentationData.title) {
      dispatch(updateTitle(next));
      trackEvent(MixpanelEvent.Presentation_Title_Updated, {
        pathname,
        presentation_id,
        previous_title_length: (presentationData.title || "").length,
        next_title_length: next.length,
      });
    }
    setIsEditingTitle(false);
  };

  const cancelTitleEdit = () => {
    setDraftTitle(presentationData?.title || "");
    setIsEditingTitle(false);
  };

  const handleTitleBlur = () => {
    queueMicrotask(() => {
      const intent = titleBlurIntentRef.current;
      titleBlurIntentRef.current = "none";
      if (intent === "cancel" || intent === "save") return;
      commitTitleEdit();
    });
  };

  const onTitleSaveMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    titleBlurIntentRef.current = "save";
  };

  const onTitleCancelMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    titleBlurIntentRef.current = "cancel";
  };

  const exportViaIpc = async (
    format: "pptx" | "pdf",
    title: string
  ): Promise<void> => {
    if (!window.electron?.exportPresentation) {
      throw new Error("Electron export bridge is unavailable");
    }
    const result = await window.electron.exportPresentation(
      presentation_id,
      title,
      format
    );
    if (!result?.success) {
      throw new Error(result?.message || "Export failed");
    }
  };

  const rgbToHex = (rgb: string) => {
    if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return "FFFFFF";
    const matches = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (!matches) return "FFFFFF";
    if (matches[4] !== undefined && parseFloat(matches[4]) === 0) return "FFFFFF";
    const r = parseInt(matches[1]).toString(16).padStart(2, '0');
    const g = parseInt(matches[2]).toString(16).padStart(2, '0');
    const b = parseInt(matches[3]).toString(16).padStart(2, '0');
    return (r + g + b).toUpperCase();
  };

  const scrapeSlide = (slideEl: HTMLElement, iframeWin: Window) => {
    const slideRect = slideEl.getBoundingClientRect();
    const W = slideRect.width || 1280;
    const H = slideRect.height || 720;
    
    const toInches = (rect: DOMRect) => {
      return {
        x: ((rect.left - slideRect.left) / W) * 10.0,
        y: ((rect.top - slideRect.top) / H) * 5.625,
        w: (rect.width / W) * 10.0,
        h: (rect.height / H) * 5.625
      };
    };

    const elements: any[] = [];

    const walk = (el: Element) => {
      const style = iframeWin.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }

      // 1. Image check
      if (el.tagName === 'IMG') {
        const src = el.getAttribute('src');
        if (src) {
          elements.push({
            type: 'image',
            src: src,
            ...toInches(rect)
          });
        }
        return;
      }

      // 2. Shape check (colored divs, border cards, or rotated diamonds)
      const bgColor = style.backgroundColor;
      const isVisibleBg = bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent' && bgColor !== 'rgb(255, 255, 255)';
      const hasBorder = style.borderWidth && parseFloat(style.borderWidth) > 0 && style.borderColor && style.borderColor !== 'transparent';
      
      const isDiamond = el.classList.contains('rotate-45') || style.transform.includes('rotate(45deg)') || style.transform.includes('matrix');
      const isLine = rect.height <= 6 || rect.width <= 6;

      if ((isVisibleBg || hasBorder) && (isLine || el.classList.contains('rounded-[10px]') || isDiamond)) {
        elements.push({
          type: 'shape',
          shapeType: isDiamond ? 'diamond' : 'rect',
          fill: rgbToHex(bgColor),
          border: hasBorder ? { color: rgbToHex(style.borderColor), width: parseFloat(style.borderWidth) } : undefined,
          ...toInches(rect)
        });
        if (isLine) return; // Stop walking children of visual lines/div dividers
      }

      // 3. Text Nodes check
      let hasDirectText = false;
      for (let i = 0; i < el.childNodes.length; i++) {
        const node = el.childNodes[i];
        if (node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim().length > 0) {
          hasDirectText = true;
          break;
        }
      }

      if (hasDirectText) {
        const text = (el as HTMLElement).innerText || el.textContent || "";
        const fontSize = parseFloat(style.fontSize) * 0.75; // convert px to pt
        const color = rgbToHex(style.color);
        const isBold = parseInt(style.fontWeight) >= 600 || style.fontWeight === 'bold';
        const isItalic = style.fontStyle === 'italic';
        const align = style.textAlign;

        elements.push({
          type: 'text',
          text: text,
          color: color,
          fontSize: fontSize,
          bold: isBold,
          italic: isItalic,
          align: align,
          fontFace: style.fontFamily.replace(/['"]/g, '').split(',')[0].trim(),
          ...toInches(rect)
        });
        return; // Avoid walking sub-children of simple text elements
      }

      for (let i = 0; i < el.children.length; i++) {
        walk(el.children[i]);
      }
    };

    walk(slideEl);
    return elements;
  };

  const handleExportPptx = async () => {
    if (isStreaming) return;

    let exportToastId: string | number | undefined;
    try {
      trackEvent(MixpanelEvent.Presentation_Export_Started, {
        pathname,
        presentation_id,
        format: "pptx",
        slide_count: presentationData?.slides?.length || 0,
      });
      exportToastId = notify.loading(
        "Exporting PPTX",
        "Your presentation is being exported. This may take a moment."
      );
      setIsExporting(true);
      
      // Save presentation content before export
      await PresentationGenerationApi.updatePresentationContent(
        presentationData
      );
      
      const safePptxFileName = buildSafeExportFileName(
        presentationData?.title,
        "pptx"
      );
      const safePptxTitle = safePptxFileName.replace(/\.pptx$/i, "");
      
      if (window.electron?.exportPresentation) {
        await exportViaIpc("pptx", safePptxTitle);
      } else {
        // 1. Create a hidden iframe pointing to /pdf-maker to render all slides
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.width = '1280px';
        iframe.style.height = '720px';
        iframe.style.left = '-9999px';
        iframe.style.top = '-9999px';
        iframe.src = `/pdf-maker?id=${presentation_id}`;
        document.body.appendChild(iframe);

        // 2. Wait for iframe to load and render
        await new Promise((resolve) => {
          iframe.onload = () => {
            setTimeout(resolve, 800); // Allow React templates and fonts to fully render
          };
        });

        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        const iframeWin = iframe.contentWindow;
        if (!iframeDoc || !iframeWin) {
          throw new Error("Could not access export frame document");
        }

        // 3. Scrape slide DOM elements into high-fidelity PPTX vectors
        const slidesData: any[] = [];
        const slideElements = iframeDoc.querySelectorAll('.main-slide');
        
        slideElements.forEach((slideEl, index) => {
          const elements = scrapeSlide(slideEl as HTMLElement, iframeWin);
          const speakerNote = slideEl.getAttribute('data-speaker-note') || "";
          const isCover = index === 0;
          
          const layoutRoot = slideEl.querySelector('.slide-edit-stage > *');
          let bgColor = "rgb(255, 255, 255)";
          if (layoutRoot) {
            const bg = iframeWin.getComputedStyle(layoutRoot).backgroundColor;
            if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
              bgColor = bg;
            } else {
              const slideInner = slideEl.querySelector('.slide-export-inner') || slideEl;
              bgColor = iframeWin.getComputedStyle(slideInner).backgroundColor || "rgb(255, 255, 255)";
            }
          } else {
            const slideInner = slideEl.querySelector('.slide-export-inner') || slideEl;
            bgColor = iframeWin.getComputedStyle(slideInner).backgroundColor || "rgb(255, 255, 255)";
          }
          
          slidesData.push({
            index,
            isCover,
            bgColor: rgbToHex(bgColor),
            speakerNote,
            elements
          });
        });

        // 4. Remove temporary iframe
        document.body.removeChild(iframe);

        // 5. Send vector layout to backend for compilation
        const response = await fetch("/api/export-presentation", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            format: "pptx",
            id: presentation_id,
            title: safePptxTitle,
            slidesData
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to export PPTX");
        }

        const { path: pptxPath } = await response.json();
        if (!pptxPath) {
          throw new Error("No path returned from export");
        }

        downloadLink(pptxPath, safePptxFileName);
      }
      
      notify.success(
        "Export complete",
        "Your PPTX file has been downloaded.",
        { id: exportToastId }
      );
    } catch (error) {
      console.error("Export failed:", error);
      notify.error(
        "Export failed",
        "We are having trouble exporting your presentation. Please try again.",
        exportToastId !== undefined ? { id: exportToastId } : undefined
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (isStreaming) return;

    let exportToastId: string | number | undefined;
    try {
      trackEvent(MixpanelEvent.Presentation_Export_Started, {
        pathname,
        presentation_id,
        format: "pdf",
        slide_count: presentationData?.slides?.length || 0,
      });
      exportToastId = notify.loading(
        "Exporting PDF",
        "Your presentation is being exported. This may take a moment."
      );
      setIsExporting(true);
      // Save the presentation data before exporting
      await PresentationGenerationApi.updatePresentationContent(
        presentationData
      );
      const safePdfFileName = buildSafeExportFileName(
        presentationData?.title,
        "pdf"
      );
      const safePdfTitle = safePdfFileName.replace(/\.pdf$/i, "");
      if (window.electron?.exportPresentation) {
        await exportViaIpc("pdf", safePdfTitle);
      } else {
        const response = await fetch("/api/export-presentation", {
          method: "POST",
          body: JSON.stringify({
            format: "pdf",
            id: presentation_id,
            title: safePdfTitle,
          }),
        });

        if (response.ok) {
          const { path: pdfPath } = await response.json();
          downloadLink(pdfPath, safePdfFileName);
        } else {
          throw new Error("Failed to export PDF");
        }
      }
      notify.success(
        "Export complete",
        "Your PDF file has been downloaded.",
        { id: exportToastId }
      );
    } catch (err) {
      console.error(err);
      notify.error(
        "Export failed",
        "We are having trouble exporting your presentation. Please try again.",
        exportToastId !== undefined ? { id: exportToastId } : undefined
      );
    } finally {
      setIsExporting(false);
    }
  };
  const handleReGenerate = () => {
    setIsRegenerateConfirmOpen(false);
    dispatch(clearPresentationData());
    dispatch(clearHistory());
    trackEvent(MixpanelEvent.Presentation_Regenerated, {
      pathname,
      presentation_id,
      slide_count: presentationData?.slides?.length || 0,
    });
    router.push(`/presentation?id=${presentation_id}&stream=true`);
  };
  const downloadLink = (path: string, fileName: string) => {
    const link = document.createElement("a");
    link.href = path;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const ExportOptions = ({ mobile }: { mobile: boolean }) => (
    <div
      className={` rounded-[18px] max-md:mt-4 ${mobile ? "" : "bg-white"}  p-5`}
    >
      <p className="text-sm font-medium text-[#19001F]">Export as</p>
      <div className="my-[18px] h-[1px] bg-[#E8E8E8]" />
      <div className="space-y-3">
        <Button
          onClick={() => {
            handleExportPdf();
            setOpen(false);
          }}
          variant="ghost"
          className={`  rounded-none px-0 w-full text-xs flex justify-start text-black hover:bg-transparent ${
            mobile ? "bg-white py-6 border-none rounded-lg" : ""
          }`}
        >
          PDF
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Button>
        <Button
          onClick={() => {
            handleExportPptx();
            setOpen(false);
          }}
          variant="ghost"
          className={`w-full flex px-0 justify-start text-xs text-black hover:bg-transparent  ${
            mobile ? "bg-white py-6" : ""
          }`}
        >
          PPTX
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );

  const titleBlock = (
    <div
      className={cn(
        "min-w-0 max-w-[min(640px,calc(100vw-12rem))] flex-1 transition-[box-shadow] duration-200",
        isEditingTitle && "relative z-[60]"
      )}
    >
      {isEditingTitle ? (
        <div className="flex items-stretch w-[450px]  gap-0.5 rounded-[14px] border border-[#E4E2EB] bg-white pl-3.5 pr-1 py-1 shadow-[0_2px_12px_rgba(17,3,31,0.06)] ring-2 ring-[#5141e5]/15">
          <input
            ref={titleInputRef}
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                titleBlurIntentRef.current = "save";
                commitTitleEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                titleBlurIntentRef.current = "cancel";
                cancelTitleEdit();
              }
            }}
            placeholder="Presentation title"
            className="min-w-0 flex-1 bg-transparent py-2 pr-2 font-unbounded text-base leading-tight text-[#101323] placeholder:text-[#101323]/35 outline-none border-0 focus:ring-0"
            aria-label="Presentation title"
          />
          <div className="flex shrink-0 items-center gap-0.5 border-l border-[#EDECEC] pl-1 ml-0.5">
            <ToolTip content="Save · Enter">
              <button
                type="button"
                onMouseDown={onTitleSaveMouseDown}
                onClick={commitTitleEdit}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5141e5] hover:bg-[#5141e5]/10 transition-colors"
                aria-label="Save title"
              >
                <Check className="h-4 w-4" strokeWidth={2.25} />
              </button>
            </ToolTip>
            <ToolTip content="Cancel · Esc">
              <button
                type="button"
                onMouseDown={onTitleCancelMouseDown}
                onClick={cancelTitleEdit}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#101323]/55 hover:bg-[#F6F6F9] hover:text-[#101323] transition-colors"
                aria-label="Cancel editing title"
              >
                <X className="h-4 w-4" strokeWidth={2.25} />
              </button>
            </ToolTip>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={beginTitleEdit}
          disabled={isStreaming || !presentationData}
          className={cn(
            "group/title flex w-full min-w-0 items-center gap-2.5 rounded-[14px] px-3 py-2 text-left -mx-3 transition-colors",
            "hover:bg-[#F6F6F9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5141e5] focus-visible:ring-offset-2",
            "disabled:pointer-events-none disabled:opacity-100 disabled:hover:bg-transparent"
          )}
        >
          <h2 className="min-w-0 flex-1 font-unbounded text-lg w-[450px] leading-snug text-[#101323]">
            <MarkdownRenderer
              content={presentationData?.title || "Presentation"}
              className="mb-0 min-w-0 overflow-hidden text-ellipsis line-clamp-1 text-sm text-[#101323] prose-p:my-0 prose-headings:my-0"
            />
          </h2>
          {presentationData && !isStreaming && (
            <Pencil
              className="h-3.5 w-3.5 shrink-0 text-[#101323]/40 transition-all duration-200 group-hover/title:text-[#5141e5] opacity-80 sm:opacity-0 sm:group-hover/title:opacity-100 group-hover/title:opacity-100"
              aria-hidden
            />
          )}
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="py-[18px] px-4 sticky top-0 bg-white z-50 shadow-sm font-syne flex justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <img
            onClick={() => {
              router.push("/dashboard");
            }}
            src="/logo-with-bg.png"
            alt=""
            className="w-10 h-10 cursor-pointer object-contain"
          />
          {presentationData && !isStreaming && !isEditingTitle ? (
            <ToolTip content="Rename presentation">{titleBlock}</ToolTip>
          ) : (
            titleBlock
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {isPresentationSaving && (
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            </div>
          )}
          {presentationData &&
            presentationData.slides &&
            !presentationData.slides[0].layout.includes("custom") && (
              <ThemeSelector
                current_theme={presentationData?.theme || {}}
                themes={themes}
              />
            )}

          <div className="flex items-center gap-2 bg-[#F6F6F9] px-3.5 h-[38px] border border-[#EDECEC] rounded-[80px]">
            <ToolTip content="Regenerate Presentation">
              <button
                type="button"
                onClick={() => setIsRegenerateConfirmOpen(true)}
                className="group"
              >
                <RotateCcw className="w-3.5 h-3.5 text-[#101323] group-hover:text-[#5141e5] duration-300" />
              </button>
            </ToolTip>
            <Separator orientation="vertical" className="h-4" />
            <ToolTip content="Undo">
              <button
                disabled={!canUndo}
                className=" disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer group"
                onClick={() => {
                  onUndo();
                }}
              >
                <Undo2 className="w-3.5 h-3.5 text-[#101323] group-hover:text-[#5141e5] duration-300" />
              </button>
            </ToolTip>
            <Separator orientation="vertical" className="h-4" />
            <ToolTip content="Redo">
              <button
                disabled={!canRedo}
                className=" disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer group"
                onClick={() => {
                  onRedo();
                }}
              >
                <Redo2 className="w-3.5 h-3.5 text-[#101323] group-hover:text-[#5141e5] duration-300" />
              </button>
            </ToolTip>
            <Separator orientation="vertical" className="h-4 w-[2px]" />
            <ToolTip content="Present">
              <button
                onClick={() => {
                  const to = `?id=${presentation_id}&mode=present&slide=${
                    currentSlide || 0
                  }`;
                  trackEvent(MixpanelEvent.Presentation_Mode_Entered, {
                    pathname,
                    presentation_id,
                    slide_index: currentSlide || 0,
                    slide_count: presentationData?.slides?.length || 0,
                  });
                  trackEvent(MixpanelEvent.Navigation, { from: pathname, to });
                  router.push(to);
                }}
                disabled={
                  isStreaming ||
                  !presentationData?.slides ||
                  presentationData?.slides.length === 0
                }
                className="cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <Play className="w-3.5 h-3.5 text-[#101323] group-hover:text-[#5141e5] duration-300" />
              </button>
            </ToolTip>
          </div>

          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                className="flex  items-center gap-[7px] px-[18px] py-[11px] rounded-[53px] text-sm font-semibold text-[#101323]"
                style={{
                  background:
                    "linear-gradient(270deg, #D5CAFC 2.4%, #E3D2EB 27.88%, #F4DCD3 69.23%, #FDE4C2 100%)",
                }}
                disabled={isExporting || isStreaming === true}
              >
                {isExporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  "Export"
                )}{" "}
                <ArrowRightFromLine className="w-3.5 h-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[200px] rounded-[18px] space-y-2 p-0  "
            >
              <ExportOptions mobile={false} />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <Dialog
        open={isRegenerateConfirmOpen}
        onOpenChange={setIsRegenerateConfirmOpen}
      >
        <DialogContent className="w-[360px] rounded-2xl border-0 p-0 shadow-2xl sm:max-w-[360px]">
          <DialogHeader className="items-center px-6 pb-4 pt-6 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
              <AlertTriangle className="h-6 w-6 text-red-500" />
            </div>
            <DialogTitle className="text-lg font-semibold text-[#191919]">
              Regenerate Presentation?
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-gray-500">
              This will replace the current slides with a newly generated
              version and clear undo history. Your current edits may be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row border-t border-gray-100 p-0 sm:space-x-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsRegenerateConfirmOpen(false)}
              className="h-auto flex-1 rounded-none rounded-bl-2xl px-4 py-3.5 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-700"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleReGenerate}
              className="h-auto flex-1 rounded-none rounded-br-2xl border-l border-gray-100 px-4 py-3.5 text-sm font-medium text-red-500 hover:bg-red-50 hover:text-red-600"
            >
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PresentationHeader;
