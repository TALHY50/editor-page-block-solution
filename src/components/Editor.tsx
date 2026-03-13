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
    return new URLSearchParams(window.location.search).get('id')?.trim() || 'default';
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
  html { background: #c8c8c8 !important; padding: 32px 0; min-height: 100%; }
  body {
    width: 794px !important; margin: 0 auto !important;
    background: transparent !important;
    outline: none; word-wrap: break-word;
    cursor: text; caret-color: #000;
  }
  .doc-page {
    width: 794px; min-height: 1122px; padding: 94px;
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
    border: 1px solid #000;
    padding: 4px 6px;
    vertical-align: top;
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
  var USABLE = 934; // 1122 - 94top - 94bottom
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
  mc.style.cssText = 'width:606px;position:relative;';
  document.body.appendChild(mc);
  nodes.forEach(function (n) { mc.appendChild(n); });

  /* ══ STEP 3: Measure after 2 rAF (browser finishes layout) ══ */
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      runPagination();
    });
  });

  function runPagination() {
    /* Read scrollHeight for each node (not offsetTop — avoids position:absolute quirks) */
    var heights = [];
    nodes.forEach(function (n, i) {
      if (n.nodeType !== 1) { heights[i] = 0; return; }
      var cs  = window.getComputedStyle(n);
      var mt  = parseFloat(cs.marginTop)    || 0;
      var mb  = parseFloat(cs.marginBottom) || 0;
      heights[i] = Math.max(0, (n.scrollHeight || n.offsetHeight || 0) + mt + mb);
    });

    console.log('[Pager] heights[0..9]:', heights.slice(0, 10));
    console.log('[Pager] total height:', heights.reduce(function(a,b){return a+b;},0));

    /* Forced page-break detection (inline styles + CSS class 'new-page') */
    var forced = nodes.map(function (n) {
      if (n.nodeType !== 1) return false;
      var st = n.getAttribute('style') || '';
      var cls = n.className || '';
      return /page-break-before\s*:\s*always|break-before\s*:\s*page|mso-break-type\s*:\s*section-break/i.test(st) ||
             /\bnew-page\b/.test(cls);
    });

    /* ══ STEP 4: Bucket by cumulative height ══ */
    var groups  = [[]];
    var cumH    = [0];

    nodes.forEach(function (n, i) {
      var pi  = groups.length - 1;
      var h   = heights[i];
      var cur = cumH[pi];

      if (forced[i] && groups[pi].length > 0) {
        groups.push([]); cumH.push(0); pi = groups.length - 1;
      } else if (groups[pi].length > 0 && cur + h > USABLE + TOLERANCE) {
        // If element is oversized (won't fit on ANY page alone) and current page
        // is less than 40% full, keep it here to avoid a huge gap
        if (h > USABLE && cur < USABLE * 0.4) {
          // Keep on current page — avoids unsightly gap
        } else {
          groups.push([]); cumH.push(0); pi = groups.length - 1;
        }
      }
      groups[pi].push(i);
      cumH[pi] += h;
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
      badge.textContent = String(pNum);
      page.appendChild(badge);
      document.body.appendChild(page);
    });

    console.log('[Pager] pages built:', pNum);

    /* ══ STEP 6: Reveal + real-time overflow monitoring ══ */
    document.body.style.visibility = '';
    document.body.contentEditable = 'true';
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

    /* ── Real-time pagination: overflow → push to next page ── */
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

        /* ── OVERFLOW: page too tall → push last child to next page ── */
        while (page.scrollHeight > PAGE_FULL_H) {
          var kids = Array.from(page.childNodes).filter(function (n) {
            return !(n.nodeType === 1 && n.className === 'doc-page-num');
          });
          if (kids.length <= 1) break;

          var overflow = kids[kids.length - 1];

          /* Skip oversized elements (e.g. large tables) — they won't fit on any page */
          if (overflow.nodeType === 1) {
            var overflowH = overflow.scrollHeight || overflow.offsetHeight || 0;
            if (overflowH > PAGE_FULL_H - 188) break;
          }

          /* Check if cursor is inside the element being moved */
          var cursorInOverflow = false;
          if (cursorNode) {
            cursorInOverflow = overflow.contains(cursorNode) || overflow === cursorNode;
          }

          var nextPage = pages[pi + 1];
          if (!nextPage) {
            nextPage = document.createElement('div');
            nextPage.className = 'doc-page';
            nextPage.setAttribute('contenteditable', 'true');
            var nb = document.createElement('span');
            nb.className = 'doc-page-num';
            nextPage.appendChild(nb);
            page.parentNode.insertBefore(nextPage, page.nextSibling);
            pages.splice(pi + 1, 0, nextPage);
          }

          var nextBadge = nextPage.querySelector('.doc-page-num');
          nextPage.insertBefore(overflow, nextBadge);
          changed = true;

          /* If cursor was in the moved element, remember it */
          if (cursorInOverflow) {
            movedCursorEl = overflow;
          }
        }

        /* No underflow: content only flows DOWN, never pulled back up. */
      }

      /* Clean empty pages */
      document.querySelectorAll('.doc-page').forEach(function (p) {
        var kids2 = Array.from(p.childNodes).filter(function (n) {
          return !(n.nodeType === 1 && n.className === 'doc-page-num');
        });
        if (kids2.length === 0) p.parentNode.removeChild(p);
      });

      /* Update page numbers */
      document.querySelectorAll('.doc-page').forEach(function (p, idx) {
        var badge = p.querySelector('.doc-page-num');
        if (badge) badge.textContent = String(idx + 1);
      });

      /* Restore cursor in moved element */
      if (movedCursorEl && sel) {
        try {
          var range = document.createRange();
          range.setStart(cursorNode, cursorOffset);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          movedCursorEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch (e) {
          // fallback: just focus the moved element
          if (movedCursorEl.focus) movedCursorEl.focus();
        }
      }

      if (changed) nh();
    }

    /* ── Enter at page end → new line on next page top ── */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;

      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var range = sel.getRangeAt(0);

      // Find which .doc-page cursor is in
      var curPage = null;
      var node = range.startContainer;
      var walk = (node.nodeType === 1) ? node : node.parentElement;
      while (walk) {
        if (walk.classList && walk.classList.contains('doc-page')) { curPage = walk; break; }
        walk = walk.parentElement;
      }
      if (!curPage) return;

      // How far is cursor from the bottom of this page?
      var pageRect = curPage.getBoundingClientRect();
      var cursorY  = range.getBoundingClientRect().bottom;
      var bottomPad = 94 + 14; // page padding + badge
      var remain = (pageRect.bottom - bottomPad) - cursorY;

      // If more than ~40px of usable space remains, let browser handle Enter normally
      if (remain > 40) return;

      // ── Page is full: intercept Enter ──
      e.preventDefault();

      // Find or create next page
      var allPages = Array.from(document.querySelectorAll('.doc-page'));
      var idx = allPages.indexOf(curPage);
      var nextPage = allPages[idx + 1];

      if (!nextPage) {
        nextPage = document.createElement('div');
        nextPage.className = 'doc-page';
        nextPage.setAttribute('contenteditable', 'true');
        var nb = document.createElement('span');
        nb.className = 'doc-page-num';
        nextPage.appendChild(nb);
        curPage.parentNode.insertBefore(nextPage, curPage.nextSibling);
      }

      // Insert empty <p> at top of next page (before existing content + badge)
      var newP = document.createElement('p');
      var br = document.createElement('br');
      newP.appendChild(br); // visible empty line
      // Insert as first child (before all existing content)
      var firstChild = nextPage.firstChild;
      // But find the first non-badge child to insert before
      var insertBefore = null;
      var ch = nextPage.firstChild;
      while (ch) {
        if (ch.nodeType === 1 && ch.className === 'doc-page-num') {
          ch = ch.nextSibling;
          continue;
        }
        insertBefore = ch;
        break;
      }
      if (insertBefore) {
        nextPage.insertBefore(newP, insertBefore);
      } else {
        var badge = nextPage.querySelector('.doc-page-num');
        if (badge) nextPage.insertBefore(newP, badge);
        else nextPage.appendChild(newP);
      }

      // Move cursor into the new paragraph
      var r2 = document.createRange();
      r2.setStart(newP, 0);
      r2.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r2);

      // Scroll to show the next page
      newP.scrollIntoView({ block: 'start', behavior: 'smooth' });

      // Update page numbers
      document.querySelectorAll('.doc-page').forEach(function (p, i) {
        var b = p.querySelector('.doc-page-num');
        if (b) b.textContent = String(i + 1);
      });
      nh();
    });

    /* Run rebalance on next animation frame after any input */
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
