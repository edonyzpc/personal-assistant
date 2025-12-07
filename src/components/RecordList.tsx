import { useEffect, useMemo, useRef } from "react";
import {
  App,
  Component,
  MarkdownRenderer,
  Platform,
  Vault,
  getFrontMatterInfo,
} from "obsidian";
import type { PluginManager } from "plugin";

type Props = {
  app: App;
  plugin: PluginManager;
  fileNames: string[];
  container: HTMLElement;
};

enum EmbedType {
  Image = "Image",
  Audio = "Audio",
  Video = "Video",
  PDF = "PDF",
  Note = "Note",
  Unknown = "Unknown",
}

const embedTypeToAcceptedExtensions: Record<EmbedType, string[]> = {
  [EmbedType.Image]: ["png", "jpg", "jpeg", "gif", "bmp", "svg"],
  [EmbedType.Audio]: ["mp3", "webm", "wav", "m4a", "ogg", "3gp", "flac"],
  [EmbedType.Video]: ["mp4", "webm", "ogv", "mov", "mkv"],
  [EmbedType.PDF]: ["pdf"],
  [EmbedType.Note]: [],
  [EmbedType.Unknown]: [],
};

const embedTypeToSrcRegex: Record<string, RegExp> = {};
Object.keys(embedTypeToAcceptedExtensions).forEach((key) => {
  embedTypeToSrcRegex[key] = new RegExp(
    `.+\\.(${(embedTypeToAcceptedExtensions as any)[key].join("|")}).*`,
    "i"
  );
});

function determineEmbedType(node: Element): EmbedType {
  const src = node.getAttribute("src");
  if (!src) return EmbedType.Unknown;
  for (const [embedTypeKey, embedTypeRegex] of Object.entries(embedTypeToSrcRegex)) {
    if (src.match(embedTypeRegex as RegExp)) {
      return (EmbedType as any)[embedTypeKey];
    }
  }
  return EmbedType.Note;
}

function getClosestMatchingFilePath(vault: Vault, mediaSrc: string, containingNotePath: string) {
  const parts = containingNotePath.split("/");
  parts.pop();
  const containingDir = parts.join("/");
  let normalizedPathSuffix = mediaSrc;

  if (mediaSrc.startsWith(".")) {
    const resourcePathParts = containingNotePath.split("/");
    resourcePathParts.pop();
    for (const suffixPart of mediaSrc.split("/")) {
      if (suffixPart === "..") {
        resourcePathParts.pop();
      } else if (suffixPart === ".") {
        continue;
      } else {
        resourcePathParts.push(suffixPart);
      }
    }
    normalizedPathSuffix = resourcePathParts.join("/");
  }

  const allMatches: string[] = [];
  for (const file of vault.getFiles()) {
    if (file.path.endsWith(normalizedPathSuffix)) {
      if (file.path === normalizedPathSuffix) return file.path;
      allMatches.push(file.path);
    }
  }

  allMatches.sort((left, right) => {
    if (left.startsWith(containingDir) && !right.startsWith(containingDir)) return -1;
    if (right.startsWith(containingDir) && !left.startsWith(containingDir)) return 1;
    return left <= right ? -1 : 1;
  });

  return allMatches[0] ?? mediaSrc;
}

function getMediaUri(vault: Vault, mediaSrc: string, containingNotePath: string) {
  const matchingPath = getClosestMatchingFilePath(vault, mediaSrc, containingNotePath);
  return vault.adapter.getResourcePath(matchingPath);
}

function isPluginEnabled(app: App, pluginID: string) {
  // @ts-expect-error obsidian plugins map
  return app.plugins?.manifests?.hasOwnProperty(pluginID) && app.plugins?.enabledPlugins?.has(pluginID);
}

function getNoteUri(app: App, noteHref: string) {
  if (isPluginEnabled(app, "obsidian-advanced-uri")) {
    return [
      "obsidian://advanced-uri?vault=",
      encodeURIComponent(app.vault.getName()),
      "&filepath=",
      encodeURIComponent(noteHref),
      "&openmode=true",
    ].join("");
  }
  return [
    "obsidian://open?vault=",
    encodeURIComponent(app.vault.getName()),
    "&file=",
    encodeURIComponent(noteHref),
  ].join("");
}

async function renderMarkdown(
  app: App,
  markdown: string,
  containerEl: HTMLElement,
  sourcePath: string,
  lifecycleComponent: Component
) {
  const { contentStart } = getFrontMatterInfo(markdown);
  const contentWithoutFrontmatter = markdown.slice(contentStart);

  await MarkdownRenderer.render(app, contentWithoutFrontmatter, containerEl, sourcePath, lifecycleComponent);

  const nodes = containerEl.querySelectorAll("span.internal-embed");
  nodes.forEach((node) => {
    const embedType = determineEmbedType(node);
    switch (embedType) {
      case EmbedType.Image: {
        const img = createEl("img");
        img.src = getMediaUri(app.vault, node.getAttribute("src") as string, sourcePath);
        node.empty();
        node.appendChild(img);
        break;
      }
      case EmbedType.Audio: {
        const audio = createEl("audio");
        audio.controls = true;
        audio.src = getMediaUri(app.vault, node.getAttribute("src") as string, sourcePath);
        node.empty();
        node.appendChild(audio);
        break;
      }
      case EmbedType.Video: {
        const video = createEl("video");
        video.controls = true;
        video.src = getMediaUri(app.vault, node.getAttribute("src") as string, sourcePath);
        node.empty();
        node.appendChild(video);
        break;
      }
      case EmbedType.PDF: {
        if (!Platform.isDesktop) return;
        const iframe = createEl("iframe");
        iframe.src = getMediaUri(app.vault, node.getAttribute("src") as string, sourcePath);
        iframe.width = "100%";
        iframe.height = "500px";
        node.empty();
        node.appendChild(iframe);
        break;
      }
      case EmbedType.Note: {
        const nodeSrc = node.getAttribute("src") as string;
        const callout = createDiv();
        callout.setAttribute("data-callout-metadata", "");
        callout.setAttribute("data-callout-fold", "-");
        callout.setAttribute("data-callout", "abstract");
        callout.addClasses(["callout", "is-collapsible", "is-collapsed"]);
        const calloutTitle = callout.createDiv();
        calloutTitle.addClass("callout-title");
        const calloutIcon = calloutTitle.createDiv();
        calloutIcon.addClass("callout-icon");
        calloutIcon.innerText = "↗";
        const calloutTitleInner = calloutTitle.createDiv();
        calloutTitleInner.addClass("callout-title-inner");
        const link = createEl("a");
        link.target = "_blank";
        link.rel = "noopener";
        link.addClass("internal-link");
        link.setText(nodeSrc + " 💨");
        link.href = getNoteUri(app, nodeSrc);
        calloutTitleInner.appendChild(link);
        node.empty();
        node.appendChild(callout);
        break;
      }
      case EmbedType.Unknown:
      default:
        break;
    }
  });

  const links = containerEl.querySelectorAll("a.internal-link");
  links.forEach((node) => {
    if (!node.getAttribute("href")) return;
    const link = node as HTMLLinkElement;
    link.addEventListener("click", (evt) => {
      evt.stopPropagation();
    });
    if (link.href.startsWith("obsidian://")) return;
    link.href = getNoteUri(app, link.getAttribute("href") as string);
  });
}

const RecordList = ({ app, plugin, fileNames, container }: Props) => {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const lifecycle = useMemo(() => new Component(), []);

  useEffect(() => {
    refs.current = refs.current.slice(0, fileNames.length);
  }, [fileNames.length]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      for (let idx = 0; idx < fileNames.length; idx++) {
        const fileName = fileNames[idx];
        const el = refs.current[idx];
        if (!el) continue;
        const fileString = await app.vault.adapter.read(fileName);
        if (cancelled) return;
        el.empty();
        await renderMarkdown(app, fileString, el, fileName, lifecycle);

        const noteName = fileName.split("\\").pop()?.split("/").pop();
        if (noteName) {
          const uri = getNoteUri(app, noteName);
          el.setAttribute("onclick", `location.href='${uri}'`);
          el.setAttribute("style", "cursor:pointer");
        }
      }
    }
    run();
    return () => {
      cancelled = true;
      lifecycle.unload();
    };
  }, [app, fileNames, lifecycle, plugin]);

  const isMobile = Platform.isMobile;

  return (
    <div className="markdown-reading-view" style={{ width: "100%", height: "100%" }}>
      <div
        className="markdown-preview-view markdown-rendered node-insert-event is-readable-line-width allow-fold-headings show-indentation-guide allow-fold-lists show-properties"
        tabIndex={-1}
        style={{ tabSize: 4 }}
      >
        <div className="markdown-preview-sizer markdown-preview-section">
          <div className="markdown-preview-pusher" style={{ width: 1, height: 0.1, marginBottom: 0 }} />
        </div>

        <div className="recordlist-wrapper" id="persoanl-assistant-record-list">
          {fileNames.map((_, idx) => (
            <div
              key={idx}
              ref={(el) => {
                refs.current[idx] = el;
              }}
              className={isMobile ? "record-wrapper-mobile" : "record-wrapper"}
              id={`record-wrapper-sub-${idx}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default RecordList;
