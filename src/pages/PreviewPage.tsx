import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { fetchShareByToken, type SharedPublication } from '../store/shares';
import { plainText } from '../lib/richtext';
import type { Block, Page, TableBlock } from '../types';
import { canvasAspect, effectiveColumns, marginFractions, pageDimsMm } from '../grid/presets';
import { BlockView } from '../components/editor/BlockView';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconFileText,
  IconLock,
  IconTable,
  IconZoomIn,
  IconZoomOut,
} from '../components/Icons';

export function PreviewPage() {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<SharedPublication | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination & Zoom
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) {
      setError('Invalid share link.');
      setLoading(false);
      return;
    }

    let active = true;
    fetchShareByToken(token, user)
      .then((res) => {
        if (!active) return;
        if (!res) {
          setError('Share link not found.');
        } else {
          setData(res);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load publication.');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, user]);

  const copyText = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const copyAllText = () => {
    if (!data) return;
    const allLines: string[] = [];
    data.pages.forEach((p, pi) => {
      allLines.push(`--- Page ${pi + 1} (${p.kind}) ---`);
      p.blocks.forEach((b) => {
        if (b.type === 'text') {
          allLines.push(plainText(b.body));
        } else if (b.type === 'table') {
          allLines.push(tableToTSV(b));
        }
      });
      allLines.push('');
    });
    copyText('ALL_PAGES', allLines.join('\n\n'));
  };

  const currentPage = data?.pages[pageIndex] ?? null;

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" />
        <p className="muted text-sm" style={{ marginTop: 12 }}>
          Loading shared publication...
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="center-screen">
        <div
          className="card"
          style={{ maxWidth: 420, textAlign: 'center', padding: '32px 24px' }}
        >
          <IconAlertTriangle size={36} style={{ color: 'var(--warning)', margin: '0 auto 12px' }} />
          <h2 style={{ margin: '0 0 8px' }}>Unavailable Publication</h2>
          <p className="muted text-sm" style={{ margin: '0 0 20px' }}>
            {error || 'This publication is no longer accessible.'}
          </p>
          <Link to="/" className="btn btn-primary" style={{ margin: '0 auto' }}>
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (data.isExpired) {
    return (
      <div className="center-screen">
        <div
          className="card"
          style={{ maxWidth: 420, textAlign: 'center', padding: '32px 24px' }}
        >
          <IconAlertTriangle size={36} style={{ color: 'var(--danger)', margin: '0 auto 12px' }} />
          <h2 style={{ margin: '0 0 8px' }}>Share Link Expired</h2>
          <p className="muted text-sm" style={{ margin: '0 0 20px' }}>
            The time limit for this preview link has ended. Please request a new share link from the
            publication author.
          </p>
        </div>
      </div>
    );
  }

  if (data.requiresAuth) {
    return (
      <div className="center-screen">
        <div
          className="card"
          style={{ maxWidth: 420, textAlign: 'center', padding: '32px 24px' }}
        >
          <IconLock size={36} style={{ color: 'var(--primary)', margin: '0 auto 12px' }} />
          <h2 style={{ margin: '0 0 8px' }}>Authentication Required</h2>
          <p className="muted text-sm" style={{ margin: '0 0 20px' }}>
            This publication is restricted to RMIT team members. Please sign in with your account to
            view and copy its contents.
          </p>
          <Link to="/login" className="btn btn-primary" style={{ margin: '0 auto' }}>
            Sign In to RMIT Dispatch
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--surface-3)',
        overflow: 'hidden',
      }}
    >
      {/* Top Header Bar */}
      <header
        style={{
          height: 54,
          padding: '0 20px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        {/* Left info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 800,
              fontSize: '15px',
              letterSpacing: '-0.02em',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>RMIT</span>
            <span style={{ fontWeight: 400, opacity: 0.75 }}>Preview</span>
          </div>

          <span style={{ color: 'var(--border-strong)' }}>/</span>

          <strong
            style={{
              fontSize: '14px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {data.docTitle}
          </strong>

          <span className="pill pill-accent text-capitalize" style={{ fontSize: '11px' }}>
            {data.docKind}
          </span>

          {data.versionNumber && (
            <span
              className={`pill ${data.isOlderVersion ? 'pill-warning' : 'pill-success'}`}
              style={{ fontSize: '11px' }}
            >
              v{data.versionNumber} {data.versionLabel ? `· ${data.versionLabel}` : ''}
            </span>
          )}
        </div>

        {/* Center: Page navigation & Zoom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--surface-2)',
              padding: '2px 6px',
              borderRadius: 6,
              border: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              className="icon-btn"
              disabled={pageIndex <= 0}
              onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
              title="Previous page"
            >
              <IconChevronLeft size={14} />
            </button>

            <span style={{ fontSize: '12px', fontWeight: 600, padding: '0 6px' }}>
              Page {pageIndex + 1} of {data.pages.length}
              {currentPage?.kind === 'spread' ? ' (Spread)' : ''}
            </span>

            <button
              type="button"
              className="icon-btn"
              disabled={pageIndex >= data.pages.length - 1}
              onClick={() => setPageIndex((i) => Math.min(data.pages.length - 1, i + 1))}
              title="Next page"
            >
              <IconChevronRight size={14} />
            </button>
          </div>

          {/* Zoom controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              background: 'var(--surface-2)',
              padding: '2px',
              borderRadius: 6,
              border: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              className="icon-btn"
              title="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))}
            >
              <IconZoomOut size={13} />
            </button>
            <span style={{ fontSize: '11px', width: 36, textAlign: 'center', fontWeight: 600 }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              className="icon-btn"
              title="Zoom in"
              onClick={() => setZoom((z) => Math.min(2.0, +(z + 0.1).toFixed(1)))}
            >
              <IconZoomIn size={13} />
            </button>
          </div>
        </div>

        {/* Right action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ gap: 5, fontSize: '12px' }}
            onClick={copyAllText}
            title="Copy all text across all pages"
          >
            {copiedId === 'ALL_PAGES' ? <IconCheck size={13} /> : <IconCopy size={13} />}
            {copiedId === 'ALL_PAGES' ? 'All text copied!' : 'Copy all text'}
          </button>
        </div>
      </header>

      {/* Older Version Notification Banner */}
      {data.isOlderVersion && (
        <div
          style={{
            padding: '10px 20px',
            background: 'var(--warning-wash, rgba(234, 179, 8, 0.12))',
            borderBottom: '1px solid var(--warning)',
            color: 'var(--warning)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '13px',
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconAlertTriangle size={16} />
            <span>
              You are viewing an older snapshot (<strong>v{data.versionNumber}</strong>). The latest
              published version is <strong>v{data.latestVersionNumber}</strong>.
            </span>
          </div>
        </div>
      )}

      {/* Canvas Area */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 40,
        }}
      >
        {currentPage && (
          <PreviewPageSurface
            page={currentPage}
            grid={data.grid}
            zoom={zoom}
            copiedId={copiedId}
            onCopy={copyText}
          />
        )}
      </div>
    </div>
  );
}

function PreviewPageSurface({
  page,
  grid,
  zoom,
  copiedId,
  onCopy,
}: {
  page: Page;
  grid: SharedPublication['grid'];
  zoom: number;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
}) {
  const aspect = canvasAspect(grid, page.kind);
  const cols = effectiveColumns(grid, page.kind);
  const rows = grid.rows;
  const isSpread = page.kind === 'spread';
  const { x: mx, y: my } = marginFractions(grid, page.kind);
  const dims = pageDimsMm(grid);
  const canvasWmm = isSpread ? dims.w * 2 + grid.spineMm : dims.w;
  const pageWFrac = dims.w / canvasWmm;

  // Base display width
  const baseWidth = isSpread ? 1100 : 640;
  const widthPx = baseWidth * zoom;

  return (
    <div
      className="page-surface"
      style={{
        width: widthPx,
        aspectRatio: `${aspect}`,
        fontSize: Math.max(8, widthPx / 46),
        position: 'relative',
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-lg)',
        borderRadius: 3,
        outline: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      {/* Margin guides in preview */}
      {isSpread ? (
        <>
          <div
            className="margin-guide"
            style={{
              left: `${mx * 100}%`,
              right: `${(1 - pageWFrac + mx) * 100}%`,
              top: `${my * 100}%`,
              bottom: `${my * 100}%`,
              opacity: 0.15,
            }}
          />
          <div
            className="margin-guide"
            style={{
              left: `${(pageWFrac + mx) * 100}%`,
              right: `${mx * 100}%`,
              top: `${my * 100}%`,
              bottom: `${my * 100}%`,
              opacity: 0.15,
            }}
          />
          <div
            className="spine-guide"
            style={{ left: `${(dims.w / canvasWmm) * 100}%`, opacity: 0.2 }}
          />
        </>
      ) : (
        <div
          className="margin-guide"
          style={{
            left: `${mx * 100}%`,
            right: `${mx * 100}%`,
            top: `${my * 100}%`,
            bottom: `${my * 100}%`,
            opacity: 0.15,
          }}
        />
      )}

      {/* Render Blocks */}
      {page.blocks.map((block) => (
        <PreviewBlockItem
          key={block.id}
          block={block}
          cols={cols}
          rows={rows}
          copiedId={copiedId}
          onCopy={onCopy}
        />
      ))}
    </div>
  );
}

function PreviewBlockItem({
  block,
  cols,
  rows,
  copiedId,
  onCopy,
}: {
  block: Block;
  cols: number;
  rows: number;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const { pos } = block;
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${(pos.col / cols) * 100}%`,
    top: `${(pos.row / rows) * 100}%`,
    width: `${(pos.w / cols) * 100}%`,
    height: `${(pos.h / rows) * 100}%`,
    borderRadius: 2,
    overflow: 'hidden',
  };

  const isText = block.type === 'text';
  const isTable = block.type === 'table';
  const canCopy = isText || isTable;
  const isCopied = copiedId === block.id;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isText) {
      onCopy(block.id, plainText(block.body));
    } else if (isTable) {
      onCopy(block.id, tableToTSV(block));
    }
  };

  return (
    <div
      style={{
        ...style,
        outline: hovered && canCopy ? '1px solid var(--accent)' : '1px solid transparent',
        transition: 'outline-color 0.15s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <BlockView block={block} />

      {/* Quick-copy button on text and table blocks */}
      {canCopy && (
        <button
          type="button"
          onClick={handleCopy}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            padding: '3px 8px',
            fontSize: '11px',
            fontWeight: 600,
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: isCopied ? 'var(--success)' : 'var(--surface)',
            color: isCopied ? '#fff' : 'var(--text)',
            border: isCopied ? '1px solid var(--success)' : '1px solid var(--border-strong)',
            borderRadius: 4,
            boxShadow: 'var(--shadow-sm)',
            cursor: 'pointer',
            opacity: hovered || isCopied ? 1 : 0,
            transform: hovered || isCopied ? 'scale(1)' : 'scale(0.9)',
            transition: 'opacity 0.15s ease, transform 0.15s ease, background 0.15s ease',
            zIndex: 5,
            pointerEvents: hovered || isCopied ? 'auto' : 'none',
          }}
          title={isText ? 'Copy text to clipboard' : 'Copy entire table data'}
        >
          {isCopied ? (
            <>
              <IconCheck size={12} /> Copied!
            </>
          ) : (
            <>
              {isText ? <IconFileText size={12} /> : <IconTable size={12} />}
              {isText ? 'Copy text' : 'Copy table'}
            </>
          )}
        </button>
      )}
    </div>
  );
}

function tableToTSV(table: TableBlock): string {
  return table.rows
    .map((row) => row.map((cell) => plainText(cell).replace(/\t/g, ' ')).join('\t'))
    .join('\n');
}
