export type BasicRect = {
    left: number;
    top: number;
    width: number;
    height: number;
};

export type TypeaheadPosition = {
    left: number;
    top: number;
};

export type TypeaheadPositionResult = 'positioned' | 'unavailable' | 'hidden';

const TEXT_MIRROR_PROPERTIES = [
    'border-bottom-width',
    'border-left-width',
    'border-right-width',
    'border-top-width',
    'box-sizing',
    'font-family',
    'font-size',
    'font-style',
    'font-variant',
    'font-weight',
    'letter-spacing',
    'line-height',
    'max-width',
    'min-width',
    'overflow-wrap',
    'padding-bottom',
    'padding-left',
    'padding-right',
    'padding-top',
    'tab-size',
    'text-align',
    'text-indent',
    'text-rendering',
    'text-transform',
    'white-space',
    'word-break',
    'word-spacing',
    'word-wrap',
] as const;

function rectData(rect: DOMRect | { left: number; top: number; width: number; height: number }): BasicRect {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function intersectRects(first: BasicRect, second: BasicRect): BasicRect | null {
    const left = Math.max(first.left, second.left);
    const top = Math.max(first.top, second.top);
    const right = Math.min(first.left + first.width, second.left + second.width);
    const bottom = Math.min(first.top + first.height, second.top + second.height);
    if (right <= left || bottom <= top) return null;
    return { left, top, width: right - left, height: bottom - top };
}

export function caretRectFromMirror(input: {
    markerRect: BasicRect;
    mirrorRect: BasicRect;
    textAreaRect: BasicRect;
    scrollLeft: number;
    scrollTop: number;
    height: number;
}): BasicRect {
    return {
        left: input.markerRect.left - input.mirrorRect.left
            + input.textAreaRect.left - input.scrollLeft,
        top: input.markerRect.top - input.mirrorRect.top
            + input.textAreaRect.top - input.scrollTop,
        width: Math.max(input.markerRect.width, 1),
        height: input.height,
    };
}

/**
 * Measure the caret with a short-lived textarea mirror. The mirror is removed
 * synchronously so callers can invoke this on every caret-affecting event.
 */
export function measureTextAreaCaret(textArea: HTMLTextAreaElement): BasicRect | null {
    const ownerDocument = textArea.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    const parent = textArea.parentElement;
    if (!ownerDocument || !ownerWindow || !parent || typeof ownerWindow.getComputedStyle !== 'function') return null;

    const textEnd = Math.max(
        Math.min(textArea.selectionStart ?? textArea.value.length, textArea.value.length),
        0,
    );
    const mirror = ownerDocument.createElement('div');
    const marker = ownerDocument.createElement('span');
    const sourceStyle = ownerWindow.getComputedStyle(textArea);
    mirror.className = 'pa-chat-caret-measure';
    marker.textContent = '​';
    for (const property of TEXT_MIRROR_PROPERTIES) {
        mirror.style.setProperty(property, sourceStyle.getPropertyValue(property));
    }
    const borderLeftWidth = Number.parseFloat(sourceStyle.getPropertyValue('border-left-width')) || 0;
    const borderRightWidth = Number.parseFloat(sourceStyle.getPropertyValue('border-right-width')) || 0;
    const mirrorWidth = textArea.clientWidth + borderLeftWidth + borderRightWidth;
    mirror.style.setProperty('display', 'block');
    mirror.style.setProperty('position', 'absolute');
    mirror.style.setProperty('left', '0');
    mirror.style.setProperty('top', '0');
    mirror.style.setProperty('box-sizing', 'border-box');
    mirror.style.setProperty('width', Number.isFinite(mirrorWidth) && mirrorWidth > 0
        ? `${mirrorWidth}px`
        : sourceStyle.getPropertyValue('width'));
    mirror.style.setProperty('height', 'auto');
    mirror.style.setProperty('margin', '0');
    mirror.style.setProperty('border-style', 'solid');
    mirror.style.setProperty('overflow', 'hidden');
    mirror.style.setProperty('pointer-events', 'none');
    mirror.style.setProperty('resize', 'none');
    mirror.style.setProperty('visibility', 'hidden');
    mirror.style.setProperty('z-index', '-1');
    mirror.append(ownerDocument.createTextNode(textArea.value.slice(0, textEnd)), marker);

    try {
        parent.appendChild(mirror);
        const markerRect = marker.getBoundingClientRect();
        const mirrorRect = mirror.getBoundingClientRect();
        const textAreaRect = textArea.getBoundingClientRect();
        const height = markerRect.height
            || Number.parseFloat(sourceStyle.getPropertyValue('line-height'))
            || Number.parseFloat(sourceStyle.getPropertyValue('font-size')) * 1.2;
        return caretRectFromMirror({
            markerRect: rectData(markerRect),
            mirrorRect: rectData(mirrorRect),
            textAreaRect: rectData(textAreaRect),
            scrollLeft: textArea.scrollLeft,
            scrollTop: textArea.scrollTop,
            height,
        });
    } finally {
        mirror.remove();
    }
}

export function clampTypeaheadPosition(input: {
    caretRect: BasicRect;
    typeaheadSize: { width: number; height: number };
    positioningParent: BasicRect;
    boundary: BasicRect;
    margin?: number;
    gap?: number;
}): TypeaheadPosition | null {
    const margin = input.margin ?? 8;
    const gap = input.gap ?? 4;
    const caretLeft = input.caretRect.left;
    const caretTop = input.caretRect.top;
    const caretBottom = input.caretRect.top + input.caretRect.height;
    const boundaryRight = input.boundary.left + input.boundary.width - margin;
    const boundaryBottom = input.boundary.top + input.boundary.height - margin;
    const boundaryTop = input.boundary.top + margin;
    const width = Math.min(input.typeaheadSize.width, input.boundary.width - margin * 2);
    const height = Math.min(input.typeaheadSize.height, input.boundary.height - margin * 2);
    if (width <= 0 || height <= 0) return null;

    const preferredLeft = Math.min(
        Math.max(caretLeft, input.boundary.left + margin),
        boundaryRight - width,
    );
    let left = preferredLeft - input.positioningParent.left;
    const belowTop = caretBottom + gap;
    const aboveTop = caretTop - gap - height;
    const belowFits = belowTop + height <= boundaryBottom;
    const aboveFits = aboveTop >= boundaryTop;
    let top: number;
    if (belowFits) {
        top = belowTop;
    } else if (aboveFits) {
        top = aboveTop;
    } else {
        const belowSpace = boundaryBottom - caretBottom;
        const aboveSpace = caretTop - boundaryTop;
        top = belowSpace >= aboveSpace ? belowTop : aboveTop;
    }
    top = Math.min(Math.max(top, boundaryTop), boundaryBottom - height) - input.positioningParent.top;
    left = Math.min(Math.max(left, input.boundary.left + margin - input.positioningParent.left),
        boundaryRight - width - input.positioningParent.left);
    return { left, top };
}

export function positionTypeaheadNearCaret(
    textArea: HTMLTextAreaElement,
    typeahead: HTMLElement,
    boundaryElement: HTMLElement,
): TypeaheadPositionResult {
    const caretRect = measureTextAreaCaret(textArea);
    const positioningParent = typeahead.parentElement;
    const ownerWindow = boundaryElement.ownerDocument?.defaultView;
    if (!caretRect || !positioningParent || !ownerWindow) return 'unavailable';

    const textAreaRect = textArea.getBoundingClientRect();
    const caretBottom = caretRect.top + caretRect.height;
    if (
        caretRect.left < textAreaRect.left - 1
        || caretRect.left > textAreaRect.right + 1
        || caretRect.top < textAreaRect.top - 1
        || caretBottom > textAreaRect.bottom + 1
    ) return 'hidden';

    const viewport = {
        left: ownerWindow.visualViewport?.offsetLeft ?? ownerWindow.scrollX,
        top: ownerWindow.visualViewport?.offsetTop ?? ownerWindow.scrollY,
        width: ownerWindow.visualViewport?.width ?? ownerWindow.innerWidth,
        height: ownerWindow.visualViewport?.height ?? ownerWindow.innerHeight,
    };
    const boundary = intersectRects(viewport, boundaryElement.getBoundingClientRect());
    if (!boundary) return 'hidden';
    const position = clampTypeaheadPosition({
        caretRect,
        typeaheadSize: { width: typeahead.offsetWidth, height: typeahead.offsetHeight },
        positioningParent: positioningParent.getBoundingClientRect(),
        boundary,
    });
    if (!position) return 'hidden';
    typeahead.style.setProperty('left', `${position.left}px`);
    typeahead.style.setProperty('top', `${position.top}px`);
    typeahead.style.setProperty('bottom', 'auto');
    typeahead.style.setProperty('margin-top', '0');
    return 'positioned';
}
