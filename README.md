# TipTap Visual Pagination Editor

This project is a high-fidelity rich text editor built with **TipTap** (ProseMirror) that implements **Google Docs-style visual pagination** without splitting the document content into multiple editors.

## How it Works

### Visual Pagination via Decorations
Unlike many implementations that split the document into multiple `contenteditable` divs, this editor uses **ProseMirror Decorations (Widgets)**. 
1. The document remains a **single continuous flow** of ProseMirror nodes.
2. A TipTap extension measures the rendered height of the content in real-time.
3. It identifies exactly which positions in the document correspond to "page breaks" (e.g., every 1122px of vertical space).
4. At these positions, it Injects a `contenteditable="false"` widget that contains:
   - The **Footer** of the current page.
   - A **Visual Gap** (the gray space between pages).
   - The **Header** of the next page.

### Why Content is Not Split
Splitting content into multiple editors or multiple top-level nodes is extremely fragile in ProseMirror because:
- **Selection/Cursor**: Native selection cannot easily span multiple `contenteditable` elements.
- **Undo/Redo**: Maintaining a single history across multiple editors is complex.
- **Stability**: Moving nodes between pages as you type causes flickering and cursor jumping.
By keeping the document continuous and using decorations, we ensure **100% stability** for IME, undo/redo, and native text selection.

### Differences from Google Docs
- **Google Docs**: Uses a custom-built rendering engine. Historically it was Google's own "Kix" engine (SVG/Canvas based). It manages its own layout, line-breaking, and pagination at a low level.
- **This Editor**: Uses the browser's native contenteditable engine for layout, but "tricks" the visual representation by injecting vertical spacers (widgets). This is the approach used by modern editors like **Notion** or **Confluence** for their paginated views.

## Features
- **Automatic Pagination**: Recalculates as you type, delete, or paste.
- **A4 Layout**: Precise A4 dimensions (794px x 1122px) with configurable margins.
- **Stable UX**: No cursor jumps or selection issues.
- **Print Ready**: Uses CSS `@media print` to hide visual gaps and apply real page breaks for PDF export.

## Tech Stack
- **React + TinyTypeScript**
- **TipTap / ProseMirror**
- **Vite**
- **Vanilla CSS** (for precise layout control)

## Development
1. `npm install`
2. `npm run dev`
3. Open `localhost` to see the editor.
# page-breaks-demo
