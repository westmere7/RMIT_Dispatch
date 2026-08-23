import { useEffect, useState } from 'react';
import { useCrumbs } from '../components/AppShell';
import { NumberField, Toggle } from '../components/Controls';
import { useDialog } from '../components/Dialog';
import {
  IconFile,
  IconGrid,
  IconHistory,
  IconImage,
  IconLink,
  IconSliders,
} from '../components/Icons';
import { GRID_PRESETS, MAX_COLUMNS, MIN_COLUMNS, PAGE_SIZES, deriveRows } from '../grid/presets';
import { COMPRESSION_LEVELS, type CompressionLevel } from '../lib/imagecompress';
import { useAuth } from '../store/auth';
import { clearAllUndoHistory } from '../store/undo';
import {
  DEFAULT_SETTINGS,
  LIMITS,
  useSettings,
  type ThemeMode,
  type UserSettings,
} from '../store/settings';
import type { Orientation, PageSize } from '../types';

/* ============================================================
   Account settings.

   Everything here is stored against the signed-in user in Postgres,
   so it follows them between machines rather than living in one
   browser.

   Layout is the desktop-app pattern: a section rail on the left, one
   pane at a time on the right. Each row is a three-column grid —
   name, explanation, control — sharing one track definition, so the
   controls line up down the whole pane however wide the window is.
   ============================================================ */

type SectionKey = 'appearance' | 'editing' | 'images' | 'fields' | 'documents';

const SECTIONS: { key: SectionKey; label: string; icon: React.ReactNode; blurb: string }[] = [
  {
    key: 'appearance',
    label: 'Appearance',
    icon: <IconSliders size={15} />,
    blurb: 'Theme, scale and motion.',
  },
  {
    key: 'editing',
    label: 'Editing',
    icon: <IconHistory size={15} />,
    blurb: 'Undo, autosave and canvas behaviour.',
  },
  {
    key: 'images',
    label: 'Images',
    icon: <IconImage size={15} />,
    blurb: 'Compression applied to uploads.',
  },
  {
    key: 'fields',
    label: 'Sync fields',
    icon: <IconLink size={15} />,
    blurb: 'Defaults for new fields.',
  },
  {
    key: 'documents',
    label: 'New documents',
    icon: <IconFile size={15} />,
    blurb: 'Page size, orientation and grid.',
  },
];

/** A labelled row with its explanation, so nothing is a mystery toggle. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="set-row">
      <div className="set-name">{label}</div>
      <div className="set-hint">{hint}</div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="set-group">
      <h3 className="set-group-title">{title}</h3>
      <div className="set-rows">{children}</div>
    </section>
  );
}

export function Settings() {
  const { setCrumbs } = useCrumbs();
  const { settings, update, reset, save, discard, dirty, saving } = useSettings();
  const { user } = useAuth();
  const dialog = useDialog();
  const [scale, setScale] = useState(settings.uiScale);
  const [section, setSection] = useState<SectionKey>('appearance');

  useEffect(() => setCrumbs(['Settings']), [setCrumbs]);
  useEffect(() => setScale(settings.uiScale), [settings.uiScale]);

  const num = (k: keyof UserSettings, key: keyof typeof LIMITS, opts?: { suffix?: string }) => (
    <NumberField
      label={key}
      value={settings[k] as number}
      min={LIMITS[key].min}
      max={LIMITS[key].max}
      step={key === 'autosaveMs' ? 100 : 1}
      suffix={opts?.suffix}
      onChange={(n) => update({ [k]: n } as Partial<UserSettings>)}
    />
  );

  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];

  return (
    <div className="settings-page">
      <header className="settings-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>Settings</h2>
          <div className="muted text-xs">
            {user?.email} · saved to your account{saving ? ' · saving…' : ''}
          </div>
        </div>
        <div className="muted text-xs settings-defaults">
          Defaults: {DEFAULT_SETTINGS.undoSteps} undo steps · {DEFAULT_SETTINGS.autosaveMs}ms
          autosave · {DEFAULT_SETTINGS.uiScale}% scale
        </div>
        <button
          className="btn"
          onClick={async () => {
            const ok = await dialog.confirm('Reset all settings to defaults?', {
              message:
                'Every value goes back to its default. Nothing is written until you press Save.',
              confirmLabel: 'Load defaults',
            });
            if (ok) reset();
          }}
        >
          Reset to defaults
        </button>
      </header>

      {/* Changes preview live but are only written on Save, so the bar
          stays visible while anything is unsaved. */}
      <div className={`settings-bar ${dirty ? 'dirty' : ''}`} role="status">
        <span className="settings-bar-text">
          {saving
            ? 'Saving…'
            : dirty
              ? 'Unsaved changes — previewing now, not yet saved to your account.'
              : 'All changes saved to your account.'}
        </span>
        <button className="btn btn-sm" disabled={!dirty || saving} onClick={discard}>
          Discard
        </button>
        <button
          className="btn btn-primary btn-sm"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          Save changes
        </button>
      </div>

      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={`settings-nav-item ${section === s.key ? 'active' : ''}`}
              onClick={() => setSection(s.key)}
              aria-current={section === s.key}
            >
              <span className="settings-nav-icon">{s.icon}</span>
              <span className="settings-nav-text">
                <span className="settings-nav-label">{s.label}</span>
                <span className="settings-nav-blurb">{s.blurb}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="settings-pane card" key={section}>
          <div className="settings-pane-head">
            <h3>{active.label}</h3>
            <span className="muted text-xs">{active.blurb}</span>
          </div>

          {section === 'appearance' && (
            <>
              <Group title="Theme">
                <Row label="Colour theme" hint="System follows your operating system.">
                  <div className="segmented">
                    {(['system', 'light', 'dark'] as ThemeMode[]).map((t) => (
                      <button
                        key={t}
                        className={settings.theme === t ? 'active' : ''}
                        onClick={() => update({ theme: t })}
                      >
                        {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
                      </button>
                    ))}
                  </div>
                </Row>
              </Group>

              <Group title="Display">
                <Row
                  label="Interface scale"
                  hint={`Scales every panel and control between ${LIMITS.uiScale.min}% and ${LIMITS.uiScale.max}%.`}
                >
                  <div className="set-slider">
                    <input
                      type="range"
                      min={LIMITS.uiScale.min}
                      max={LIMITS.uiScale.max}
                      step={5}
                      value={scale}
                      onChange={(e) => setScale(Number(e.target.value))}
                      onMouseUp={() => update({ uiScale: scale })}
                      onKeyUp={() => update({ uiScale: scale })}
                      aria-label="Interface scale"
                    />
                    <span className="set-slider-value">{scale}%</span>
                  </div>
                </Row>
                <Row label="Reduce motion" hint="Turns off transitions and animations.">
                  <Toggle
                    label="Reduce motion"
                    checked={settings.reduceMotion}
                    onChange={(v) => update({ reduceMotion: v })}
                  />
                </Row>
              </Group>
            </>
          )}

          {section === 'editing' && (
            <>
              <Group title="History">
                <Row
                  label="Undo steps"
                  hint={`How much history to keep per document (${LIMITS.undoSteps.min}–${LIMITS.undoSteps.max}). Saved to your account, so it survives a reload.`}
                >
                  {num('undoSteps', 'undoSteps')}
                </Row>
                <Row
                  label="Autosave delay"
                  hint={`Milliseconds of quiet before a draft is written (${LIMITS.autosaveMs.min}–${LIMITS.autosaveMs.max}). Also the undo step size.`}
                >
                  {num('autosaveMs', 'autosaveMs', { suffix: 'ms' })}
                </Row>
                {user && (
                  <Row
                    label="Undo history"
                    hint="Clears the saved history for every document you have edited. Documents keep their current content."
                  >
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={async () => {
                        const ok = await dialog.confirm('Clear your undo history?', {
                          message:
                            'Documents keep their current content; only the steps you could undo to are removed.',
                          confirmLabel: 'Clear history',
                          danger: true,
                        });
                        if (!ok) return;
                        await clearAllUndoHistory(user.uid).catch(() => {});
                        await dialog.alert('History cleared', {
                          message: 'Reopen a document to start a fresh history.',
                        });
                      }}
                    >
                      Clear history
                    </button>
                  </Row>
                )}
              </Group>

              <Group title="Canvas">
                <Row label="Arrow-key nudge" hint="Cells moved per arrow-key press.">
                  {num('nudgeCells', 'nudgeCells')}
                </Row>
                <Row label="Show grid lines" hint="The cell grid behind the page while editing.">
                  <Toggle
                    label="Show grid lines"
                    checked={settings.showGridLines}
                    onChange={(v) => update({ showGridLines: v })}
                  />
                </Row>
                <Row
                  label="Confirm before deleting"
                  hint="Ask before removing blocks, pages and fields."
                >
                  <Toggle
                    label="Confirm before deleting"
                    checked={settings.confirmDeletes}
                    onChange={(v) => update({ confirmDeletes: v })}
                  />
                </Row>
              </Group>
            </>
          )}

          {section === 'images' && (
            <Group title="Uploads">
              <Row
                label="Default compression"
                hint="Applied to new uploads. Everything is stored as WebP unless you pick Original."
              >
                {/* The level's own explanation goes under the field rather
                    than inside each option, which truncated the select. */}
                <div className="set-stack">
                  <select
                    className="input set-select"
                    value={settings.imageCompression}
                    onChange={(e) =>
                      update({ imageCompression: e.target.value as CompressionLevel })
                    }
                  >
                    {COMPRESSION_LEVELS.map((l) => (
                      <option key={l.key} value={l.key}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <span className="set-note">
                    {COMPRESSION_LEVELS.find((l) => l.key === settings.imageCompression)?.hint}
                  </span>
                </div>
              </Row>
            </Group>
          )}

          {section === 'fields' && (
            <Group title="New fields">
              <Row
                label="Default scope"
                hint="Project fields stay local to one project; global fields are shared across the whole space."
              >
                <div className="segmented">
                  {(['local', 'global'] as const).map((s) => (
                    <button
                      key={s}
                      className={settings.defaultFieldScope === s ? 'active' : ''}
                      onClick={() => update({ defaultFieldScope: s })}
                    >
                      {s === 'local' ? 'Project' : 'Global'}
                    </button>
                  ))}
                </div>
              </Row>
            </Group>
          )}

          {section === 'documents' && (
            <>
              <Group title="Page">
                <Row label="Page size" hint="Used when a new project or adaptation is created.">
                  <select
                    className="input set-select"
                    value={settings.defaultPageSize}
                    onChange={(e) => update({ defaultPageSize: e.target.value as PageSize })}
                  >
                    {PAGE_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Orientation">
                  <div className="segmented">
                    {(['portrait', 'landscape'] as Orientation[]).map((o) => (
                      <button
                        key={o}
                        className={settings.defaultOrientation === o ? 'active' : ''}
                        onClick={() => update({ defaultOrientation: o })}
                      >
                        {o === 'portrait' ? 'Portrait' : 'Landscape'}
                      </button>
                    ))}
                  </div>
                </Row>
              </Group>

              <Group title="Grid">
                <Row
                  label="Columns"
                  hint={`Cells are always square, so rows follow from the page proportions — currently ${deriveRows(
                    { pageSize: settings.defaultPageSize, orientation: settings.defaultOrientation },
                    settings.defaultColumns,
                  )} rows.`}
                >
                  <NumberField
                    label="Grid columns"
                    value={settings.defaultColumns}
                    min={MIN_COLUMNS}
                    max={MAX_COLUMNS}
                    onChange={(n) => update({ defaultColumns: n })}
                  />
                </Row>
                <Row label="Presets" hint="A starting point; the column count stays editable.">
                  <div className="segmented set-presets">
                    {GRID_PRESETS.map((p) => (
                      <button
                        key={p.key}
                        className={settings.defaultColumns === p.columns ? 'active' : ''}
                        onClick={() => update({ defaultColumns: p.columns })}
                        title={`${p.columns} columns`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </Row>
                <Row label="Preview" hint="How the default grid divides a page.">
                  <span className="muted text-xs">
                    <IconGrid size={12} /> {settings.defaultColumns} ×{' '}
                    {deriveRows(
                      {
                        pageSize: settings.defaultPageSize,
                        orientation: settings.defaultOrientation,
                      },
                      settings.defaultColumns,
                    )}{' '}
                    cells
                  </span>
                </Row>
              </Group>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
