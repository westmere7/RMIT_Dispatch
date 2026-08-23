import { useWorkspace, type InspectorTab } from '../../editor/workspaceContext';
import { CommentThread } from './CommentThread';
import { SyncPanel } from './SyncPanel';
import { VersionPanel } from './VersionPanel';

/* Properties live in the contextual bar above the canvas now (see
   editor/PropertiesBar.tsx), so this panel is for the things that are
   about the document rather than the current selection. */
const TABS: { key: InspectorTab; label: string }[] = [
  { key: 'sync', label: 'Sync' },
  { key: 'versions', label: 'Versions' },
  { key: 'comments', label: 'Comments' },
];

export function BlockInspector() {
  const { tab, setTab } = useWorkspace();
  return (
    <div className="side-panel">
      <div className="side-panel-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="side-panel-body">
        {tab === 'sync' && <SyncPanel />}
        {tab === 'versions' && <VersionPanel />}
        {tab === 'comments' && <CommentThread />}
      </div>
    </div>
  );
}
