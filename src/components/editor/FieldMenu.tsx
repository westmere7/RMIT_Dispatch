import { useEffect, useRef, useState } from 'react';
import { useFieldOps } from '../../editor/useFieldOps';
import { useWorkspace } from '../../editor/workspaceContext';
import { plainText, type TextRange } from '../../lib/richtext';
import { valueAsRich } from '../../lib/syncfields';
import type { RichText } from '../../types';
import { IconLink } from '../Icons';

/**
 * "Make sync field" control for a text selection — new field or an
 * existing one. Nesting, cycle checks and parent mirroring live in
 * useFieldOps.
 */
export function FieldMenu({
  getRange,
  rich,
  onRich,
  compact,
}: {
  getRange: () => TextRange | null;
  rich: RichText;
  onRich: (rich: RichText) => void;
  compact?: boolean;
}) {
  const { fields } = useWorkspace();
  const { bindRange } = useFieldOps();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const apply = async (fieldId?: string) => {
    const next = await bindRange(rich, getRange(), { fieldId });
    if (next) onRich(next);
    setOpen(false);
  };

  return (
    <span style={{ position: 'relative' }} ref={wrapRef}>
      <button
        className="btn btn-sm"
        style={{ height: compact ? 24 : 26 }}
        title="Make a sync field from the selection"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <IconLink size={12} /> Field
      </button>
      {open && (
        <div
          className="space-switcher-menu"
          style={{ left: 0, right: 'auto', maxHeight: 260, overflow: 'auto', minWidth: 210 }}
        >
          <button className="menu-item" onClick={() => void apply()}>
            ＋ New field from selection
          </button>
          {fields.length > 0 && <hr className="divider" style={{ margin: '4px 0' }} />}
          {fields.map((f) => (
            <button
              key={f.id}
              className="menu-item"
              title={plainText(valueAsRich(f.value))}
              onClick={() => void apply(f.id)}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
