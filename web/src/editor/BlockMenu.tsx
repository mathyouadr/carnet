import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Repeat2, Sparkles, Trash2 } from "lucide-react";
import { t } from "../i18n";
import { MenuItem, MenuSep, Popover } from "../ui/Popover";
import { aiName } from "./ai/AIMenu";
import { KINDS, kindOf } from "./DocsToolbar";

const stripIds = (b: any): any => ({ ...b, id: undefined, children: (b.children || []).map(stripIds) });

/** Right-click menu of one block of the editor. Text selections keep the browser menu (copy, paste). */
export function BlockMenu({ editor, blockId, at, onAI, onClose }: {
  editor: any; blockId: string; at: DOMRect; onAI?: () => void; onClose: () => void;
}) {
  const [turn, setTurn] = useState(false);
  const block = editor.getBlock(blockId);
  if (!block) return null;
  const inline = Array.isArray(block.content);
  const cur = kindOf(block);
  const run = (fn: () => void) => () => { try { fn(); } finally { onClose(); } };
  const focus = () => editor.setTextCursorPosition(blockId, "end");
  return (
    <Popover anchor={at} onClose={onClose} width={230}>
      {turn ? <>
        <MenuItem icon={<ChevronLeft size={15} />} onClick={() => setTurn(false)}>{t("Turn into")}</MenuItem>
        <MenuSep />
        {KINDS.map((k) => (
          <MenuItem key={k.key} icon={k.icon} active={k.key === cur.key}
            onClick={run(() => editor.updateBlock(blockId, { type: k.type, props: k.props || {} }))}>{t(k.label)}</MenuItem>
        ))}
      </> : <>
        {onAI && inline && <MenuItem icon={<Sparkles size={15} />} onClick={run(() => { focus(); onAI(); })}>{t("Ask {name}").replace("{name}", aiName())}</MenuItem>}
        {inline && <MenuItem icon={<Repeat2 size={15} />} right={<ChevronRight size={14} />} onClick={() => setTurn(true)}>{t("Turn into")}</MenuItem>}
        <MenuItem icon={<Copy size={15} />} onClick={run(() => editor.insertBlocks([stripIds(block)], blockId, "after"))}>{t("Duplicate")}</MenuItem>
        <MenuItem icon={<ArrowUp size={15} />} onClick={run(() => { focus(); editor.moveBlocksUp(); })}>{t("Move up")}</MenuItem>
        <MenuItem icon={<ArrowDown size={15} />} onClick={run(() => { focus(); editor.moveBlocksDown(); })}>{t("Move down")}</MenuItem>
        <MenuSep />
        <MenuItem danger icon={<Trash2 size={15} />} onClick={run(() => editor.removeBlocks([blockId]))}>{t("Delete")}</MenuItem>
      </>}
    </Popover>
  );
}
