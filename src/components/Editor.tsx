import React, { useEffect, useRef, useState, useMemo } from 'react';
import { templates } from '../templates/templates';
import '../styles/editor.css';

const Spinner = () => (
  <div className="loading-wrap">
    <div className="spinner" />
    <p>Loading document…</p>
  </div>
);

const TEMPLATE_API_BASE_URL = 'https://api.savant-api.online/api/v1/template-management/templates';

/** Parse API HTML, return { css, bodyHtml, scriptSrcs } */
function parseApiHtml(raw: string): { css: string; bodyHtml: string; scriptSrcs: string[] } {
  try {
    const doc = new DOMParser().parseFromString(raw, 'text/html');

    // Collect all <style> text from <head>
    const cssBlocks: string[] = [];
    doc.head.querySelectorAll('style').forEach(s => cssBlocks.push(s.textContent || ''));

    // Collect CDN script src URLs from <head> (e.g. Tailwind CDN)
    const scriptSrcs: string[] = [];
    doc.head.querySelectorAll('script[src]').forEach(s => {
      const src = s.getAttribute('src');
      if (src) scriptSrcs.push(src);
    });

    // Remove inline scripts from body (keep CDN ones via head)
    doc.body.querySelectorAll('script').forEach(s => s.remove());

    return { css: cssBlocks.join('\n'), bodyHtml: doc.body.innerHTML || raw, scriptSrcs };
  } catch {
    return { css: '', bodyHtml: raw, scriptSrcs: [] };
  }
}

const Editor: React.FC = () => {
  const urlTemplateId = useMemo(() => {
    const id = new URLSearchParams(window.location.search).get('id')?.trim();
    // Remove accidental trailing dots or commas
    return id?.replace(/[.,]+$/, '') || 'default';
  }, []);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iframeHeight, setIframeHeight] = useState(1200);

  const injectIntoIframe = (rawHtml: string) => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const { css: apiCss, bodyHtml, scriptSrcs } = parseApiHtml(rawHtml);

    // Build CDN script tags (e.g. Tailwind)
    const cdnScripts = scriptSrcs.map(src => `<script src="${src}"><\/script>`).join('\n');

    const fullDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  /* ── Our layout styles (come first as defaults) ── */
  * { box-sizing: border-box; }
  html { background: #c8c8c8 !important; padding: 32px 0; min-height: 100%; scrollbar-width: none; }
  html::-webkit-scrollbar { display: none; }
  body {
    width: 794px !important; margin: 0 auto !important;
    background: transparent !important;
    outline: none; word-wrap: break-word;
    cursor: text; caret-color: #000;
  }
  .doc-page {
    width: 794px; min-height: 1122px; padding: 48px;
    background: white !important;
    box-shadow: 0 2px 16px rgba(0,0,0,0.18);
    position: relative;
    /* Fallback text styles — NO text-align so original HTML alignment is preserved */
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
    color: #000;
    line-height: 1.15;
  }
  .doc-page + .doc-page { margin-top: 24px; }
  .doc-page-num {
    position: absolute; bottom: 2px; left: 0; right: 0;
    text-align: center !important; font-size: 10pt; color: #aaa;
    pointer-events: none; user-select: none;
    font-family: 'Times New Roman', serif;
  }
  /* ── Table border preservation ── */
  .doc-page table {
    border-collapse: collapse;
    width: 100%;
  }
  .doc-page table td,
  .doc-page table th {
    border: 1px solid #d1d5db; /* Lighter grey border */
    padding: 6px 8px; /* Slightly shifted for better alignment */
    vertical-align: top;
    text-align: left;
    color: #4b5563; /* Soft dark grey text instead of heavy black */
  }
  /* Let API CSS override our table defaults if it has its own styles */
  [style*="background:yellow"], [style*="background: yellow"] { background: #ffff00 !important; }
  [style*="display:none"],      [style*="display: none"]      { display: none !important; }
  .new-page { height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden; }
  @page { margin: 0; }
</style>
<style>
  /* ── API document styles (come AFTER so they override our defaults) ── */
  ${apiCss}
</style>
${cdnScripts}
</head>
<body spellcheck="false">
${bodyHtml}
</body>
<script>
(function () {
  var USABLE = 1026; // 1122 - 48top - 48bottom
  var TOLERANCE = 120; // allow content to extend slightly into bottom padding to reduce gaps

  /* ══ STEP 1: Deep-collect leaf block elements from the whole body ══
     Recurse into containers; treat P, H1-H6, TABLE, UL, OL, HR, FIGURE
     as "atomic" units that shouldn't be split further.                  */
  var nodes = [];

  // Tags treated as a single indivisible block
  var BLOCK_TAGS = /^(P|H[1-6]|TABLE|UL|OL|LI|BLOCKQUOTE|PRE|HR|FIGURE|IMG|DIV)$/;

  function collectLeaves(el) {
    var children = Array.from(el.childNodes);
    var hasBlockChild = children.some(function (c) {
      return c.nodeType === 1 && BLOCK_TAGS.test((c.tagName || '').toUpperCase());
    });

    if (!hasBlockChild) {
      // No block children → this element is a leaf. Keep it even if empty (for manual spacing)
      nodes.push(el);
      return;
    }

    // Has block children → recurse into children
    children.forEach(function (c) {
      if (c.nodeType === 3) {
        if (c.textContent.trim()) nodes.push(c);
        return;
      }
      if (c.nodeType !== 1) return;
      var tag = (c.tagName || '').toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE') return;

      var cTag = (c.tagName || '').toUpperCase();
      if (/^(TABLE|HR|IMG|FIGURE)$/.test(cTag)) {
        nodes.push(c); // always treat these as atomic
        return;
      }

      // Recurse into divs, sections, etc.
      collectLeaves(c);
    });
  }

  var bodyChildren = Array.from(document.body.childNodes);
  bodyChildren.forEach(function (n) {
    if (n.nodeType !== 1) return;
    var tag = (n.tagName || '').toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE') return;
    collectLeaves(n);
  });

  console.log('[Pager] leaf nodes:', nodes.length);

  if (!nodes.length) {
    document.body.contentEditable = 'true';
    return;
  }

  /* ══ STEP 2: Clear body, put all leaf nodes in mc for measurement ══ */
  document.body.style.visibility = 'hidden';

  // Clear body content (keep scripts/styles)
  Array.from(document.body.childNodes).forEach(function (n) {
    if (n.nodeType === 1) {
      var t = (n.tagName || '').toUpperCase();
      if (t !== 'SCRIPT' && t !== 'STYLE') document.body.removeChild(n);
    } else {
      document.body.removeChild(n);
    }
  });

  var mc = document.createElement('div');
  // Copy exactly the same typography constraints without fixed page padding
  mc.className = 'doc-page';
  mc.style.cssText = 'width:698px;position:relative;padding:0 !important;min-height:0 !important;box-shadow:none !important;visibility:hidden;';
  document.body.appendChild(mc);
  nodes.forEach(function (n) { mc.appendChild(n); });

  /* ══ STEP 3: Wait for layout and Tailwind CDN ══ */
  var attempts = 0;
  function tryPaginate() {
    attempts++;
    var hasTailwind = document.querySelector('style[id*="tailwind"]') || 
                      Array.from(document.querySelectorAll('style')).some(s => s.textContent.includes('tailwindcss'));
    if (hasTailwind || attempts > 30) { // Max ~500ms
      requestAnimationFrame(runPagination);
    } else {
      requestAnimationFrame(tryPaginate);
    }
  }
  requestAnimationFrame(tryPaginate);

  function runPagination() {
    /* Read visual geometry for each block using mc (handles margin collapse natively) */
    var mcRect = mc.getBoundingClientRect();
    var nodeGeoms = nodes.map(function(n) {
      if (n.nodeType !== 1) {
        var range = document.createRange();
        range.selectNodeContents(n);
        var res = range.getBoundingClientRect();
        return { top: res.top - mcRect.top, bottom: res.bottom - mcRect.top, h: res.bottom - res.top, mb: 0 };
      }
      var r = n.getBoundingClientRect();
      var cs = window.getComputedStyle(n);
      var mb = parseFloat(cs.marginBottom) || 0;
      return { top: r.top - mcRect.top, bottom: r.bottom - mcRect.top, h: r.bottom - r.top, mb: mb };
    });

    /* Forced page-break detection (inline styles + CSS class 'new-page') */
    var forced = nodes.map(function (n) {
      if (n.nodeType !== 1) return false;
      var st = n.getAttribute('style') || '';
      var cls = n.className || '';
      return /page-break-before\s*:\s*always|break-before\s*:\s*page|mso-break-type\s*:\s*section-break/i.test(st) ||
             /\bnew-page\b/.test(cls);
    });

    /* ══ STEP 4: Bucket by exact physical layout height ══ */
    var groups  = [[]];
    var pageStartTop = nodeGeoms.length ? nodeGeoms[0].top : 0;

    nodes.forEach(function (n, i) {
      var pi   = groups.length - 1;
      var geom = nodeGeoms[i];
      var pageCurHeight = (geom.bottom - pageStartTop) + geom.mb;

      if (forced[i] && groups[pi].length > 0) {
        groups.push([]); 
        pi = groups.length - 1;
        pageStartTop = geom.top;
      } else if (groups[pi].length > 0 && pageCurHeight > USABLE) {
        var el_h = geom.h + geom.mb;
        var cur = pageCurHeight - el_h;
        var isTable = nodes[i].tagName === 'TABLE';
        if ((el_h > USABLE && cur < USABLE * 0.4) || isTable) {
          // Keep on current page to avoid massive visually-jarring gap empty page,
          // or if it's a table so rebalancePages can split it row-by-row cleanly!
        } else {
          groups.push([]); 
          pi = groups.length - 1;
          pageStartTop = geom.top;
        }
      }
      // Re-evaluate pageCurHeight for logging or debug
      groups[pi].push(i);
    });

    console.log('[Pager] page groups:', groups.length);

    /* Detach mc (nodes now orphaned) */
    nodes.forEach(function (n) { if (n.parentNode === mc) mc.removeChild(n); });
    document.body.removeChild(mc);

    /* ══ STEP 5: Build page divs ══ */
    var pNum = 0;
    groups.forEach(function (idxs) {
      // Don't skip empty pages anymore so manual spacing via empty paragraphs works
      if (idxs.length === 0) return;

      pNum++;
      var page = document.createElement('div');
      page.className = 'doc-page';
      page.setAttribute('contenteditable', 'true');
      idxs.forEach(function (i) { page.appendChild(nodes[i]); });

      var badge = document.createElement('span');
      badge.className = 'doc-page-num';
      badge.setAttribute('contenteditable', 'false');
      badge.textContent = String(pNum);
      page.appendChild(badge);
      document.body.appendChild(page);
    });

    console.log('[Pager] pages built:', pNum);

    /* ══ STEP 6: Reveal + real-time overflow monitoring ══ */
    document.body.style.visibility = '';
    document.body.contentEditable = 'true';
    try { document.execCommand('styleWithCSS', false, true); } catch(e) {}
    document.body.focus();

    function nh() {
      window.parent.postMessage(
        { type: 'iframeHeight', height: document.documentElement.scrollHeight + 64 }, '*'
      );
    }
    new ResizeObserver(nh).observe(document.body);
    setTimeout(nh, 400);

    document.addEventListener('click', function () {
      if (!document.activeElement || document.activeElement === document.body)
        document.body.focus();
    });

    /* ── Real-time pagination: overflow → push down, underflow → pull up ── */
    var PAGE_FULL_H = 1122; // full page height incl. padding
    var rebalanceTimer = 0;

    function rebalancePages() {
      var pages = Array.from(document.querySelectorAll('.doc-page'));
      var changed = false;
      var sel = window.getSelection();
      var cursorNode = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
      var cursorOffset = sel && sel.rangeCount ? sel.getRangeAt(0).startOffset : 0;
      var movedCursorEl = null; // track if cursor's element was moved

      for (var pi = 0; pi < pages.length; pi++) {
        var page = pages[pi];
        var rebalancedOverflow = false;

        /* ── OVERFLOW: page too tall → push last child to next page ── */
        while (page.scrollHeight > PAGE_FULL_H) {
          var kids = Array.from(page.childNodes).filter(function (n) {
            return !(n.nodeType === 1 && n.className === 'doc-page-num');
          });
          if (kids.length <= 1) break;

          var overflow = kids[kids.length - 1];

          /* Skip oversized elements EXCEPT tables because we will split them */
          if (overflow.nodeType === 1 && overflow.tagName !== 'TABLE') {
            var overflowH = overflow.scrollHeight || overflow.offsetHeight || 0;
            if (overflowH > PAGE_FULL_H - 96) break;
          }

          /* TABLE SPLITTING: Overflow */
          if (overflow.tagName === 'TABLE' && overflow.rows) {
             var dataRows = Array.from(overflow.rows).filter(r => r.parentNode.tagName !== 'THEAD');
             if (dataRows.length > 1) {
                 var nextPageS = pages[pi + 1];
                 if (!nextPageS) {
                    nextPageS = document.createElement('div');
                    nextPageS.className = 'doc-page';
                    nextPageS.setAttribute('contenteditable', 'true');
                    var nbS = document.createElement('span');
                    nbS.className = 'doc-page-num';
                    nbS.setAttribute('contenteditable', 'false');
                    nextPageS.appendChild(nbS);
                    page.parentNode.insertBefore(nextPageS, page.nextSibling);
                    pages.splice(pi + 1, 0, nextPageS);
                 }
                 
                 var nextKidsS = Array.from(nextPageS.childNodes).filter(function(n) { return n.className !== 'doc-page-num'; });
                 var targetTable = nextKidsS[0];
                 var splitId = overflow.dataset.splitId || ('split-' + Math.random());
                 overflow.dataset.splitId = splitId;
                 
                 if (!targetTable || targetTable.tagName !== 'TABLE' || targetTable.dataset.splitId !== splitId) {
                    targetTable = document.createElement('table');
                    targetTable.dataset.splitId = splitId;
                    targetTable.className = overflow.className;
                    targetTable.style.cssText = overflow.style.cssText;
                    var thead = overflow.querySelector('thead');
                    if (thead) targetTable.appendChild(thead.cloneNode(true));
                    var targetTbody = document.createElement('tbody');
                    targetTable.appendChild(targetTbody);
                    var nextBadgeS = nextPageS.querySelector('.doc-page-num');
                    if (nextKidsS.length > 0) nextPageS.insertBefore(targetTable, nextKidsS[0]);
                    else nextPageS.insertBefore(targetTable, nextBadgeS || null);
                 }
                 
                 var insertTbody = targetTable.querySelector('tbody') || targetTable;
                 var lastRow = dataRows[dataRows.length - 1];
                 var cursorInRow = cursorNode && (lastRow.contains(cursorNode) || lastRow === cursorNode);
                 
                 insertTbody.insertBefore(lastRow, insertTbody.firstChild);
                 changed = true;
                 rebalancedOverflow = true;
                 if (cursorInRow) movedCursorEl = lastRow;
                 
                 var remainingData = Array.from(overflow.rows).filter(r => r.parentNode.tagName !== 'THEAD');
                 if (remainingData.length === 0) overflow.parentNode.removeChild(overflow);
                 
                 continue; 
             }
          }

          /* Default Overflow for non-tables or unsplittable tables */
          var cursorInOverflow = cursorNode && (overflow.contains(cursorNode) || overflow === cursorNode);
          var nextPage = pages[pi + 1];
          if (!nextPage) {
            nextPage = document.createElement('div');
            nextPage.className = 'doc-page';
            nextPage.setAttribute('contenteditable', 'true');
            var nb = document.createElement('span');
            nb.className = 'doc-page-num';
            nb.setAttribute('contenteditable', 'false');
            nextPage.appendChild(nb);
            page.parentNode.insertBefore(nextPage, page.nextSibling);
            pages.splice(pi + 1, 0, nextPage);
          }

          var nextKids = Array.from(nextPage.childNodes).filter(function(n) { return n.className !== 'doc-page-num'; });
          if (nextKids.length > 0) {
            nextPage.insertBefore(overflow, nextKids[0]);
          } else {
            var nextBadge = nextPage.querySelector('.doc-page-num');
            if (nextBadge) nextPage.insertBefore(overflow, nextBadge);
            else nextPage.appendChild(overflow);
          }
          
          changed = true;
          rebalancedOverflow = true;
          if (cursorInOverflow) movedCursorEl = overflow;
        }

        /* ── UNDERFLOW: page has room → pull FIRST child from NEXT page ── */
        // Only attempt underflow if we didn't just push (avoids infinite loop)
        if (!rebalancedOverflow && page.scrollHeight <= PAGE_FULL_H) {
          var nextPageU = pages[pi + 1];
          if (nextPageU) {
            var kidsU = Array.from(page.childNodes).filter(function (n) {
              return !(n.nodeType === 1 && n.className === 'doc-page-num');
            });
            var lastKid = kidsU[kidsU.length - 1];
            var pageRoom = USABLE; // 1026
            
            if (lastKid) {
              var rPage = page.getBoundingClientRect();
              var rKid = null;
              if (lastKid.nodeType === 1) rKid = lastKid.getBoundingClientRect();
              else if (lastKid.nodeType === 3) {
                 var range = document.createRange();
                 range.selectNode(lastKid);
                 rKid = range.getBoundingClientRect();
              }
              if (rKid) {
                var lastKidBottom = rKid.bottom - rPage.top;
                var mb_kid = lastKid.nodeType === 1 ? (parseFloat(window.getComputedStyle(lastKid).marginBottom) || 0) : 0;
                // Pad top is 48, max height is 1122. Usable area bottom is 48 + 1026 = 1074
                pageRoom = 1074 - (lastKidBottom + mb_kid);
              }
            }

            // If we have generous room, try pulling up
            if (pageRoom > 30) {
              var nextKids = Array.from(nextPageU.childNodes).filter(function(n) {
                return !(n.nodeType === 1 && n.className === 'doc-page-num');
              });
              var firstNext = nextKids[0];
              
              if (firstNext) {
                var cls = firstNext.nodeType === 1 ? (firstNext.className || '') : '';
                var st = firstNext.nodeType === 1 ? (firstNext.getAttribute('style') || '') : '';
                var isForced = /page-break-before\s*:\s*always|break-before\s*:\s*page|mso-break-type\s*:\s*section-break/i.test(st) ||
                               /\bnew-page\b/.test(cls);

                if (!isForced) {
                  var isSplitTableStraddling = firstNext.tagName === 'TABLE' && 
                      lastKid && lastKid.tagName === 'TABLE' &&
                      firstNext.dataset.splitId && firstNext.dataset.splitId === lastKid.dataset.splitId;
                  if (isSplitTableStraddling) {
                      var dataRows = Array.from(firstNext.rows).filter(r => r.parentNode.tagName !== 'THEAD');
                      var firstRow = dataRows[0];
                      if (firstRow) {
                          var firstRowH = firstRow.scrollHeight || firstRow.offsetHeight || 0;
                          if (firstRowH + 15 <= pageRoom) { // safe margin
                              var targetTbody = lastKid.querySelector('tbody') || lastKid;
                              var cursorInUnderflow = cursorNode && (firstRow.contains(cursorNode) || firstRow === cursorNode);
                              
                              targetTbody.appendChild(firstRow);
                              changed = true;
                              if (cursorInUnderflow) movedCursorEl = firstRow;
                              
                              var leftDataRows = Array.from(firstNext.rows).filter(r => r.parentNode.tagName !== 'THEAD');
                              if (leftDataRows.length === 0) firstNext.parentNode.removeChild(firstNext);
                          }
                      }
                  } else {
                    var firstNextH = firstNext.nodeType === 1 ? (firstNext.scrollHeight || firstNext.offsetHeight || 0) : 20;
                    var mb_first = firstNext.nodeType === 1 ? (parseFloat(window.getComputedStyle(firstNext).marginBottom) || 0) : 0;
                    var mt_first = firstNext.nodeType === 1 ? (parseFloat(window.getComputedStyle(firstNext).marginTop) || 0) : 0;
                    // margin collapse check: max of lastKid mb vs firstNext mt
                    var marginAdd = Math.max(mb_kid, mt_first) - mb_kid;
                    var totalFirstNextH = firstNextH + marginAdd + mb_first;
                    
                    if (totalFirstNextH <= pageRoom) {
                      var cursorInUnderflow = cursorNode && (firstNext.contains(cursorNode) || firstNext === cursorNode);
                      var badge = page.querySelector('.doc-page-num');
                      if (badge) page.insertBefore(firstNext, badge);
                      else page.appendChild(firstNext);
                      changed = true;
                      if (cursorInUnderflow) movedCursorEl = firstNext;
                    }
                  }
                }
              }
            }
          }
        }
      }

      /* Clean empty pages */
      document.querySelectorAll('.doc-page').forEach(function (p) {
        var kids2 = Array.from(p.childNodes).filter(function (n) {
          return !(n.nodeType === 1 && n.className === 'doc-page-num');
        });
        if (kids2.length === 0) p.parentNode.removeChild(p);
      });

      /* Update page numbers and auto-restore if accidentally deleted */
      document.querySelectorAll('.doc-page').forEach(function (p, idx) {
        var badge = p.querySelector('.doc-page-num');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'doc-page-num';
          badge.setAttribute('contenteditable', 'false');
          p.appendChild(badge);
        }
        badge.textContent = String(idx + 1);
      });

      /* Restore cursor in moved element */
      if (movedCursorEl && sel) {
        try {
          var range = document.createRange();
          range.setStart(cursorNode, cursorOffset);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          movedCursorEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        } catch (e) {
          // fallback: just focus the moved element
          if (movedCursorEl.focus) movedCursorEl.focus();
        }
      }

      if (changed) nh();
    }

    /* ── Fix Hanging Indent on Enter ── */
    /* When hitting Enter in a numbered list (or hanging indent block), 
       Chrome clones the negative text-indent causing the new block to jump left.
       We intercept this and reset the text-indent of the newly created block. */
    var lastEnterBlock = null;
    var BLOCK_TAGS = /^(P|H[1-6]|TABLE|UL|OL|LI|BLOCKQUOTE|PRE|HR|FIGURE|IMG|DIV)$/i;
    
    function getEnclosingBlock(node) {
       var walk = node.nodeType === 1 ? node : node.parentElement;
       while (walk && walk.tagName) {
          if (walk.classList && walk.classList.contains('doc-page')) return null;
          if (BLOCK_TAGS.test(walk.tagName)) return walk;
          walk = walk.parentElement;
       }
       return null;
    }

    document.addEventListener('keydown', function(e) {
       if (e.key === 'Enter' && !e.shiftKey) {
          var sel = window.getSelection();
          if (sel && sel.rangeCount) {
             lastEnterBlock = getEnclosingBlock(sel.getRangeAt(0).startContainer);
          }
       }
    });

    document.addEventListener('keyup', function(e) {
       if (e.key === 'Enter' && !e.shiftKey && lastEnterBlock) {
          setTimeout(function() {
             var sel = window.getSelection();
             if (sel && sel.rangeCount) {
                var currentBlock = getEnclosingBlock(sel.getRangeAt(0).startContainer);
                if (currentBlock && currentBlock !== lastEnterBlock) {
                   var ti = parseFloat(window.getComputedStyle(currentBlock).textIndent) || 0;
                   if (ti < 0) {
                      currentBlock.style.textIndent = '0px';
                   }
                }
             }
             lastEnterBlock = null;
             rebalancePages();
          }, 0);
       } else if (e.key === 'Enter') {
          setTimeout(rebalancePages, 0);
       }
    });

    /* Run rebalance on input, and run a few times on load to catch slow fonts/styles */
    var initialRebalanceCount = 0;
    var initIval = setInterval(function() {
        if (!document.activeElement || document.activeElement === document.body) rebalancePages();
        if (++initialRebalanceCount > 15) clearInterval(initIval);
    }, 200);

    document.addEventListener('input', function () {
      cancelAnimationFrame(rebalanceTimer);
      rebalanceTimer = requestAnimationFrame(function () {
        requestAnimationFrame(rebalancePages);
      });
    });
  }
})();
<\/script>
</html>`;

    iframe.srcdoc = fullDoc;
  };

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'iframeHeight') setIframeHeight(e.data.height);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    if (urlTemplateId === 'default') {
      const defaultTemplate = templates.find(t => t.id === 'template-1');
      if (defaultTemplate) {
        injectIntoIframe(defaultTemplate.rawHtml);
      }
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    fetch(`${TEMPLATE_API_BASE_URL}/${encodeURIComponent(urlTemplateId)}/formatted`, {
      headers: { Accept: 'text/html,text/plain;q=0.9,*/*;q=0.8' },
      signal: controller.signal,
    })
      .then(res => { if (!res.ok) throw new Error(`Server error: ${res.status}`); return res.text(); })
      .then(html => injectIntoIframe(html))
      .catch(err => { if (err.name !== 'AbortError') setError(err.message || 'Failed to load.'); })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [urlTemplateId]);

  return (
    <div className="editor-shell">
      {isLoading && <Spinner />}
      {error && <div className="error-banner">⚠️ {error}</div>}
      <iframe
        ref={iframeRef}
        className="doc-iframe"
        style={{
          height: `${iframeHeight}px`,
          display: isLoading || !urlTemplateId ? 'none' : 'block',
        }}
        title="Document Editor"
      />
    </div>
  );
};

export default Editor;
