import { useEditor } from '../../editor/EditorProvider';
import { GridPreview } from '../GridPreview';
import { IconPlus, IconTrash } from '../Icons';

export function PageRail() {
  const { state, dispatch, readOnly } = useEditor();

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
                  <span style={{ display: 'inline-flex', gap: 2 }}>
                    <span
                      role="button"
                      tabIndex={0}
                      title={page.kind === 'spread' ? 'Make single page' : 'Make spread'}
                      style={{ cursor: 'pointer', padding: '0 3px' }}
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
                      {page.kind === 'spread' ? '⇥' : '⇹'}
                    </span>
                    {state.pages.length > 1 && (
                      <span
                        role="button"
                        tabIndex={0}
                        title="Delete page"
                        style={{ cursor: 'pointer', padding: '0 3px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete page ${i + 1} and its ${page.blocks.length} block(s)?`)) {
                            dispatch({ type: 'DELETE_PAGE', pageId: page.id });
                          }
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && e.stopPropagation()}
                      >
                        <IconTrash size={11} />
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>
          </div>
        ))}

        {!readOnly && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => dispatch({ type: 'ADD_PAGE', kind: 'single' })}>
              <IconPlus size={12} /> Page
            </button>
            <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => dispatch({ type: 'ADD_PAGE', kind: 'spread' })}>
              <IconPlus size={12} /> Spread
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
