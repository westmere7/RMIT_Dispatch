import { useEditor } from '../../editor/EditorProvider';
import { useDialog } from '../Dialog';
import { GridPreview } from '../GridPreview';
import { IconSinglePage, IconSpread, IconTrash } from '../Icons';

export function PageRail() {
  const { state, dispatch, readOnly } = useEditor();
  const dialog = useDialog();

  return (
    <div className="side-panel left">
      <div className="side-panel-body">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="text-xs muted" style={{ fontWeight: 600 }}>
            PAGES
          </span>
        </div>
        {state.pages.map((page, i) => (
          <div key={page.id}>
            <button
              className={`page-thumb ${state.currentPageId === page.id ? 'active' : ''}`}
              onClick={() => dispatch({ type: 'SET_PAGE', pageId: page.id })}
            >
              <GridPreview grid={state.grid} page={page} width={999} showGrid={false} />
              <span className="thumb-label">
                <span>
                  {i + 1} · {page.kind === 'spread' ? 'Spread' : 'Page'}
                </span>
                {!readOnly && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span
                      role="button"
                      tabIndex={0}
                      title={page.kind === 'spread' ? 'Convert to single page' : 'Convert to two-page spread'}
                      style={{
                        cursor: 'pointer',
                        padding: '1px 3px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 3,
                        color: 'var(--text-muted)',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch({ type: 'TOGGLE_PAGE_KIND', pageId: page.id });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.stopPropagation();
                          dispatch({ type: 'TOGGLE_PAGE_KIND', pageId: page.id });
                        }
                      }}
                    >
                      {page.kind === 'spread' ? (
                        <IconSinglePage size={13} />
                      ) : (
                        <IconSpread size={13} />
                      )}
                    </span>
                    {state.pages.length > 1 && (
                      <span
                        role="button"
                        tabIndex={0}
                        title="Delete page"
                        style={{
                          cursor: 'pointer',
                          padding: '1px 3px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 3,
                          color: 'var(--text-muted)',
                        }}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const ok = await dialog.confirm(`Delete page ${i + 1}?`, {
                            message: `${page.blocks.length} block(s) on this page will be removed.`,
                            confirmLabel: 'Delete page',
                            danger: true,
                          });
                          if (ok) dispatch({ type: 'DELETE_PAGE', pageId: page.id });
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && e.stopPropagation()}
                      >
                        <IconTrash size={12} />
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>
          </div>
        ))}

        {!readOnly && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              className="btn btn-sm"
              style={{ flex: 1, gap: 5, fontSize: '11px' }}
              title="Add a single page"
              onClick={() => dispatch({ type: 'ADD_PAGE', kind: 'single' })}
            >
              <IconSinglePage size={13} /> Page
            </button>
            <button
              className="btn btn-sm"
              style={{ flex: 1, gap: 5, fontSize: '11px' }}
              title="Add a two-page spread"
              onClick={() => dispatch({ type: 'ADD_PAGE', kind: 'spread' })}
            >
              <IconSpread size={13} /> Spread
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
