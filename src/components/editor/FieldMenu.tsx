import { useFieldOps } from '../../editor/useFieldOps';
import { useWorkspace } from '../../editor/workspaceContext';
import { wholeTextRange, type TextRange } from '../../lib/richtext';
import type { FieldTarget } from '../../lib/fieldtypes';
import type { RichText } from '../../types';
import { IconLink, IconPlus } from '../Icons';
import { FieldPicker } from './FieldPicker';

/**
 * Sync-field controls for a text context. Two distinct actions:
 *  - **Field** binds the current SELECTION to a field (the selected text
 *    becomes, or joins, the field's value).
 *  - **Insert** drops an EXISTING field at the caret, taking its text
 *    from the field. Only type-compatible fields are selectable.
 */
export function FieldMenu({
  getRange,
  rich,
  onRich,
  compact,
  target = 'inline',
}: {
  getRange: () => TextRange | null;
  rich: RichText;
  onRich: (rich: RichText) => void;
  compact?: boolean;
  target?: FieldTarget;
}) {
  const { fields } = useWorkspace();
  const { bindRange, insertField } = useFieldOps();

  /**
   * Binding falls back to the block's whole text when nothing is
   * selected — the same rule as the canvas menu, so selecting a block
   * and selecting its text lead to the same place from either entry.
   */
  const bindTarget = () => {
    const range = getRange();
    return range && range.start !== range.end ? range : wholeTextRange(rich);
  };

  return (
    <>
      <FieldPicker
        fields={fields}
        target={target}
        label="Field"
        icon={<IconLink size={12} />}
        compact={compact}
        createLabel="New field from selection"
        onCreate={() => {
          void bindRange(rich, bindTarget()).then((next) => next && onRich(next));
        }}
        onPick={(f) => {
          void bindRange(rich, bindTarget(), { fieldId: f.id }).then((next) => next && onRich(next));
        }}
      />
      <FieldPicker
        fields={fields}
        target={target}
        label="Insert"
        icon={<IconPlus size={12} />}
        compact={compact}
        onPick={(f) => {
          void insertField(rich, getRange(), f.id, { target }).then(
            (next) => next && onRich(next),
          );
        }}
      />
    </>
  );
}
