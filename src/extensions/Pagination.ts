import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';

export const Pagination = Extension.create({
    name: 'pagination',

    addOptions() {
        return {
            pageHeight: 1122,
            pageMarginTop: 40,
            pageMarginBottom: 40,
            headerHeight: 10,
            footerHeight: 10,
            pageGap: 50,
            triggerBufferPx: 2,
            minSplitChars: 6,
            splittableNodeNames: ['paragraph', 'heading', 'blockquote'],
        };
    },

    addProseMirrorPlugins() {
        const pageHeight = Number(this.options.pageHeight);
        const pageMarginTop = Number(this.options.pageMarginTop);
        const pageMarginBottom = Number(this.options.pageMarginBottom);
        const headerHeight = Number(this.options.headerHeight);
        const footerHeight = Number(this.options.footerHeight);
        const pageGap = Number(this.options.pageGap);
        const triggerBufferPx = Number(this.options.triggerBufferPx);
        const minSplitChars = Number(this.options.minSplitChars);
        const splittableNodeNames = Array.isArray(this.options.splittableNodeNames)
            ? new Set(this.options.splittableNodeNames.map((name: unknown) => String(name)))
            : new Set<string>(['paragraph', 'heading', 'blockquote']);

        const FIXED_TOP_SPACE = pageMarginTop + headerHeight;
        const FIXED_BOTTOM_SPACE = pageMarginBottom + footerHeight;
        const pageUsableHeight = Math.max(0, pageHeight - FIXED_TOP_SPACE - FIXED_BOTTOM_SPACE);
        const PHYSICAL_USABLE_HEIGHT = pageUsableHeight;
        const TRIGGER_THRESHOLD = Math.max(1, PHYSICAL_USABLE_HEIGHT - triggerBufferPx);
        const PAGE_GAP = pageGap;

        // Unified height for the transition area between two pages
        const BREAK_OVERHEAD = FIXED_BOTTOM_SPACE + PAGE_GAP + FIXED_TOP_SPACE;

        const pluginKey = new PluginKey('pagination');
        let view: EditorView | null = null;
        let lastDecoratedDoc: ProseMirrorNode | null = null;
        let lastDecorationSet = DecorationSet.empty;
        let refreshRafId: number | null = null;
        let pendingSettledPass = false;
        let inRefreshDispatch = false;

        type ScrollSnapshot = {
            docLeft: number;
            docTop: number;
            containers: Array<{ element: HTMLElement; left: number; top: number }>;
        };

        const isScrollContainer = (element: HTMLElement) => {
            const style = window.getComputedStyle(element);
            const hasScrollableOverflow =
                /(auto|scroll|overlay)/.test(style.overflowY) || /(auto|scroll|overlay)/.test(style.overflowX);

            if (!hasScrollableOverflow) return false;
            return element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth;
        };

        const captureScrollSnapshot = (): ScrollSnapshot => {
            const containers: Array<{ element: HTMLElement; left: number; top: number }> = [];
            const editorRoot = view?.dom as HTMLElement | undefined;

            if (editorRoot) {
                let current = editorRoot.parentElement;
                while (current) {
                    if (isScrollContainer(current)) {
                        containers.push({
                            element: current,
                            left: current.scrollLeft,
                            top: current.scrollTop,
                        });
                    }
                    current = current.parentElement;
                }
            }

            const scrollingElement = document.scrollingElement as HTMLElement | null;
            const docLeft = scrollingElement?.scrollLeft ?? window.scrollX;
            const docTop = scrollingElement?.scrollTop ?? window.scrollY;

            return { docLeft, docTop, containers };
        };

        const restoreScrollSnapshot = (snapshot: ScrollSnapshot) => {
            const scrollingElement = document.scrollingElement as HTMLElement | null;
            if (scrollingElement) {
                scrollingElement.scrollLeft = snapshot.docLeft;
                scrollingElement.scrollTop = snapshot.docTop;
            } else {
                window.scrollTo(snapshot.docLeft, snapshot.docTop);
            }

            for (const container of snapshot.containers) {
                if (!container.element.isConnected) continue;
                container.element.scrollLeft = container.left;
                container.element.scrollTop = container.top;
            }
        };

        const scheduleRefresh = () => {
            if (refreshRafId !== null) return;

            refreshRafId = window.requestAnimationFrame(() => {
                refreshRafId = null;
                if (!view || !pendingSettledPass) return;

                const scrollSnapshot = captureScrollSnapshot();
                inRefreshDispatch = true;
                const tr = view.state.tr;
                tr.setMeta('paginationUpdate', true);
                view.dispatch(tr);
                window.requestAnimationFrame(() => restoreScrollSnapshot(scrollSnapshot));
            });
        };

        return [
            new Plugin({
                key: pluginKey,
                state: {
                    init: () => DecorationSet.empty,
                    apply(tr, set) {
                        const isPaginationUpdate = tr.getMeta('paginationUpdate');
                        if (tr.docChanged && !isPaginationUpdate) {
                            pendingSettledPass = true;
                            scheduleRefresh();
                        }

                        if (isPaginationUpdate) {
                            return set;
                        }
                        return set.map(tr.mapping, tr.doc);
                    },
                },
                props: {
                    decorations(state) {
                        if (!view) return DecorationSet.empty;
                        const mappedSet = (pluginKey.getState(state) as DecorationSet | undefined) ?? DecorationSet.empty;

                        // During active edits, keep mapped previous breaks and wait for one settled re-measure pass.
                        if (pendingSettledPass && !inRefreshDispatch) {
                            return mappedSet;
                        }

                        if (lastDecoratedDoc === state.doc && !inRefreshDispatch) {
                            return lastDecorationSet;
                        }

                        const decorations: Decoration[] = [];
                        let currentPageContentBottom = 0;
                        let prevNodeBottomMargin = 0;
                        let pageIndex = 1;

                        const pushPageBreak = (position: number, currentIndex: number, fillerHeight: number) => {
                            decorations.push(
                                Decoration.widget(
                                    position,
                                    () => {
                                        const widget = document.createElement('span');
                                        widget.className = 'page-break-widget';
                                        widget.contentEditable = 'false';
                                        widget.style.height = `${fillerHeight + BREAK_OVERHEAD}px`;

                                        widget.innerHTML = `
                                            <span class="page-break-content">
                                              <span class="page-filler" style="height: ${fillerHeight}px; background: white;"></span>
                                              <span class="page-footer">${currentIndex}</span>
                                              <span class="page-gap-spacer" style="height: ${PAGE_GAP}px;"></span>
                                              <span class="page-header"></span>
                                            </span>
                                        `;
                                        return widget;
                                    },
                                    {
                                        side: -1,
                                        key: `page-break-${currentIndex}-${Math.round(fillerHeight)}-${position}`,
                                        ignoreSelection: true,
                                    }
                                )
                            );
                        };

                        const getPosTop = (pos: number) => {
                            try {
                                return view!.coordsAtPos(pos).top;
                            } catch {
                                return null;
                            }
                        };

                        const findSplitPosition = (
                            nodeStart: number,
                            nodeEnd: number,
                            segmentTop: number,
                            targetTop: number
                        ) => {
                            let low = nodeStart;
                            let high = nodeEnd - 1;
                            let bestPos: number | null = null;
                            let bestTop = 0;

                            while (low <= high) {
                                const mid = Math.floor((low + high) / 2);
                                const top = getPosTop(mid);
                                if (top === null) break;

                                if (top < targetTop) {
                                    bestPos = mid;
                                    bestTop = top;
                                    low = mid + 1;
                                } else {
                                    high = mid - 1;
                                }
                            }

                            if (bestPos === null) return null;

                            let splitPos = bestPos;
                            let splitTop = bestTop;

                            // Move to the start of the chosen visual line.
                            while (splitPos > nodeStart) {
                                const prevTop = getPosTop(splitPos - 1);
                                if (prevTop === null || Math.abs(prevTop - splitTop) > 0.5) break;
                                splitPos -= 1;
                                splitTop = prevTop;
                            }

                            const charsBeforeSplit = splitPos - nodeStart;
                            const charsAfterSplit = nodeEnd - splitPos;
                            if (charsBeforeSplit < minSplitChars || charsAfterSplit < minSplitChars) {
                                return null;
                            }

                            if (splitTop <= segmentTop + 0.5) return null;
                            return { pos: splitPos, top: splitTop };
                        };

                        const isSplittableTextblock = (node: ProseMirrorNode) => {
                            if (!node.type.isTextblock) return false;
                            if (node.type.spec.code) return false;
                            if (!splittableNodeNames.has(node.type.name)) return false;
                            return node.textContent.trim().length > 1;
                        };

                        state.doc.forEach((node, offset) => {
                            const nodeDom = view!.nodeDOM(offset) as HTMLElement;
                            if (!nodeDom || typeof nodeDom.getBoundingClientRect !== 'function') return;

                            const rect = nodeDom.getBoundingClientRect();
                            const style = window.getComputedStyle(nodeDom);
                            const marginTop = parseFloat(style.marginTop) || 0;
                            const marginBottom = parseFloat(style.marginBottom) || 0;
                            const height = rect.height;

                            let gap = 0;
                            if (currentPageContentBottom > 0) {
                                gap = Math.max(prevNodeBottomMargin, marginTop);
                            } else {
                                gap = marginTop;
                            }

                            const nodePotentialBottom = currentPageContentBottom + gap + height;
                            const nodeStart = offset + 1;
                            const nodeEnd = offset + node.nodeSize - 1;
                            const canSplitInsideNode = isSplittableTextblock(node) && nodeEnd - nodeStart > 2;

                            if (nodePotentialBottom > TRIGGER_THRESHOLD && canSplitInsideNode) {
                                let consumedHeight = 0;
                                let segmentStartPos = offset;
                                let isFirstSegment = true;
                                let attempts = 0;
                                let didCompleteNode = false;

                                while (attempts < 100) {
                                    attempts += 1;

                                    const segmentGap = isFirstSegment ? gap : 0;
                                    const remainingHeight = Math.max(0, height - consumedHeight);
                                    const availableHeight = TRIGGER_THRESHOLD - currentPageContentBottom - segmentGap;

                                    if (remainingHeight <= availableHeight + 0.5) {
                                        currentPageContentBottom += segmentGap + remainingHeight;
                                        prevNodeBottomMargin = marginBottom;
                                        didCompleteNode = true;
                                        break;
                                    }

                                    if (availableHeight <= 1 && currentPageContentBottom > 0) {
                                        const fillerHeight = Math.max(0, PHYSICAL_USABLE_HEIGHT - currentPageContentBottom);
                                        pushPageBreak(segmentStartPos, pageIndex, fillerHeight);
                                        pageIndex += 1;
                                        currentPageContentBottom = 0;
                                        prevNodeBottomMargin = 0;
                                        continue;
                                    }

                                    const segmentTop = rect.top + consumedHeight;
                                    const targetTop = segmentTop + Math.max(0, availableHeight);
                                    const split = findSplitPosition(nodeStart, nodeEnd, segmentTop, targetTop);

                                    if (!split) {
                                        if (currentPageContentBottom > 0) {
                                            const fillerHeight = Math.max(0, PHYSICAL_USABLE_HEIGHT - currentPageContentBottom);
                                            pushPageBreak(segmentStartPos, pageIndex, fillerHeight);
                                            pageIndex += 1;
                                            currentPageContentBottom = 0;
                                            prevNodeBottomMargin = 0;
                                            continue;
                                        }

                                        // Fallback: if no split point can be found on an empty page, keep node whole.
                                        currentPageContentBottom += segmentGap + remainingHeight;
                                        prevNodeBottomMargin = marginBottom;
                                        didCompleteNode = true;
                                        break;
                                    }

                                    const segmentHeight = split.top - segmentTop;
                                    if (segmentHeight <= 0.5) {
                                        if (currentPageContentBottom > 0) {
                                            const fillerHeight = Math.max(0, PHYSICAL_USABLE_HEIGHT - currentPageContentBottom);
                                            pushPageBreak(segmentStartPos, pageIndex, fillerHeight);
                                            pageIndex += 1;
                                            currentPageContentBottom = 0;
                                            prevNodeBottomMargin = 0;
                                            continue;
                                        }

                                        currentPageContentBottom += segmentGap + remainingHeight;
                                        prevNodeBottomMargin = marginBottom;
                                        didCompleteNode = true;
                                        break;
                                    }

                                    const contentUsedBeforeBreak = currentPageContentBottom + segmentGap + segmentHeight;
                                    const fillerHeight = Math.max(0, PHYSICAL_USABLE_HEIGHT - contentUsedBeforeBreak);
                                    pushPageBreak(split.pos, pageIndex, fillerHeight);

                                    pageIndex += 1;
                                    currentPageContentBottom = 0;
                                    prevNodeBottomMargin = 0;
                                    consumedHeight += segmentHeight;
                                    segmentStartPos = split.pos;
                                    isFirstSegment = false;
                                }

                                if (!didCompleteNode) {
                                    const remainingHeight = Math.max(0, height - consumedHeight);
                                    currentPageContentBottom += (isFirstSegment ? gap : 0) + remainingHeight;
                                    prevNodeBottomMargin = marginBottom;
                                }
                                return;
                            }

                            if (nodePotentialBottom > TRIGGER_THRESHOLD && currentPageContentBottom > 0) {
                                const fillerHeight = Math.max(0, PHYSICAL_USABLE_HEIGHT - currentPageContentBottom);
                                pushPageBreak(offset, pageIndex, fillerHeight);

                                pageIndex += 1;
                                currentPageContentBottom = marginTop + height;
                                prevNodeBottomMargin = marginBottom;
                                return;
                            }

                            currentPageContentBottom = nodePotentialBottom;
                            prevNodeBottomMargin = marginBottom;
                        });

                        // --- FINAL PAGE FILLER ---
                        if (currentPageContentBottom >= 0) {
                            const lastPageIndex = pageIndex;
                            const fillerHeight = Math.max(0, PHYSICAL_USABLE_HEIGHT - currentPageContentBottom);

                            decorations.push(
                                Decoration.widget(
                                    state.doc.content.size,
                                    () => {
                                        const widget = document.createElement('div');
                                        widget.className = 'last-page-area';
                                        widget.contentEditable = 'false';

                                        widget.style.height = `${fillerHeight + FIXED_BOTTOM_SPACE}px`;

                                        widget.innerHTML = `
                                            <div style="height: ${fillerHeight}px; width: 100%; background: white;"></div>
                                            <div class="page-footer">${lastPageIndex}</div>
                                        `;
                                        return widget;
                                    },
                                    { side: 1, key: `last-page-footer-${lastPageIndex}-${Math.round(currentPageContentBottom)}` }
                                )
                            );
                        }

                        const decorationSet = DecorationSet.create(state.doc, decorations);
                        lastDecoratedDoc = state.doc;
                        lastDecorationSet = decorationSet;

                        if (inRefreshDispatch) {
                            inRefreshDispatch = false;
                            pendingSettledPass = false;
                        }

                        return decorationSet;
                    },
                },
                view(editorView) {
                    view = editorView;
                    lastDecoratedDoc = null;
                    lastDecorationSet = DecorationSet.empty;
                    return {
                        update(updatedView, prevState) {
                            view = updatedView;
                            if (updatedView.state.doc !== prevState.doc && !pendingSettledPass) {
                                lastDecoratedDoc = null;
                                pendingSettledPass = true;
                                scheduleRefresh();
                            }
                        },
                        destroy() {
                            if (refreshRafId !== null) {
                                window.cancelAnimationFrame(refreshRafId);
                                refreshRafId = null;
                            }
                            pendingSettledPass = false;
                            inRefreshDispatch = false;
                        },
                    };
                },
            }),
        ];
    },
});
