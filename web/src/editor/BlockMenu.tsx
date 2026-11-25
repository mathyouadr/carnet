import { useState } from "react";
import { ArrowDown, ArrowUp, Bold, ChevronLeft, ChevronRight, ClipboardCopy, ClipboardPaste, Code, Copy, Italic, Repeat2, Scissors, SpellCheck, Sparkles, Strikethrough, Trash2, Underline } from "lucide-react";
import { useApp } from "../app/store";
import { t } from "../i18n";
import { MenuItem, MenuSep, Popover } from "../ui/Popover";
import { aiName } from "./ai/AIMenu";
import { KINDS, kindOf } from "./DocsToolbar";
import type { useBlockSelect } from "./blockSelect";

const stripIds = (b: any): any => ({ ...b, id: undefined, children: (b.children || []).map(stripIds) });

/** Right-click menu of one block of the editor. Text selections keep the browser menu (copy, paste). */
export function BlockMenu({ editor, blockId, at, onAI, onSpell, onClose }: {
  editor: any; blockId: string; at: DOMRect; onAI?: () => void; onSpell?: (only?: string[]) => void; onClose: () => void;
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
        {onSpell && <MenuItem icon={<SpellCheck size={15} />} onClick={run(() => onSpell())}>{t("Check spelling and grammar")}</MenuItem>}
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

/** Right-click menu when text is selected: clipboard, formatting, AI, turn into. */
export function SelectionMenu({ editor, at, onAI, onSpell, onClose }: { editor: any; at: DOMRect; onAI?: () => void; onSpell?: (only?: string[]) => void; onClose: () => void }) {
  const [turn, setTurn] = useState(false);
  const app = useApp();
  const run = (fn: () => void | Promise<void>) => async () => { onClose(); editor.focus(); try { await fn(); } catch { app.toast(t("Clipboard access refused: use Ctrl V")); } };
  const style = (s: string) => run(() => { editor.toggleStyles({ [s]: true }); });
  const blocks = (): any[] => editor.getSelection()?.blocks || [editor.getTextCursorPosition().block];
  const turnable = blocks().every((b) => Array.isArray(b.content));
  return (
    <Popover anchor={at} onClose={onClose} width={230}>
      {turn ? <>
        <MenuItem icon={<ChevronLeft size={15} />} onClick={() => setTurn(false)}>{t("Turn into")}</MenuItem>
        <MenuSep />
        {KINDS.map((k) => (
          <MenuItem key={k.key} icon={k.icon}
            onClick={run(() => { for (const b of blocks()) editor.updateBlock(b.id, { type: k.type, props: k.props || {} }); })}>{t(k.label)}</MenuItem>
        ))}
      </> : <>
        {onAI && <MenuItem icon={<Sparkles size={15} />} onClick={run(() => onAI())}>{t("Ask {name}").replace("{name}", aiName())}</MenuItem>}
        {onSpell && <MenuItem icon={<SpellCheck size={15} />} onClick={() => { const ids = blocks().map((b) => b.id); onClose(); onSpell(ids); }}>{t("Check spelling and grammar")}</MenuItem>}
        {turnable && <MenuItem icon={<Repeat2 size={15} />} right={<ChevronRight size={14} />} onClick={() => setTurn(true)}>{t("Turn into")}</MenuItem>}
        <MenuSep />
        <MenuItem icon={<Scissors size={15} />} onClick={run(() => { document.execCommand("cut"); })}>{t("Cut")}</MenuItem>
        <MenuItem icon={<Copy size={15} />} onClick={run(() => { document.execCommand("copy"); })}>{t("Copy")}</MenuItem>
        <MenuItem icon={<ClipboardPaste size={15} />} onClick={run(async () => {
          const txt = await navigator.clipboard.readText();
          if (txt) editor.pasteText(txt); else app.toast(t("Clipboard is empty"));
        })}>{t("Paste")}</MenuItem>
        <MenuSep />
        <MenuItem icon={<Bold size={15} />} onClick={style("bold")}>{t("Bold")}</MenuItem>
        <MenuItem icon={<Italic size={15} />} onClick={style("italic")}>{t("Italic")}</MenuItem>
        <MenuItem icon={<Underline size={15} />} onClick={style("underline")}>{t("Underline")}</MenuItem>
        <MenuItem icon={<Strikethrough size={15} />} onClick={style("strike")}>{t("Strikethrough")}</MenuItem>
        <MenuItem icon={<Code size={15} />} onClick={style("code")}>{t("Code")}</MenuItem>
      </>}
    </Popover>
  );
}

/** Right-click menu on several selected blocks (Notion block selection: marquee, Esc, Shift+arrows). */
export function BlocksMenu({ editor, sel, at, onAI, onSpell, onClose }: {
  editor: any; sel: ReturnType<typeof useBlockSelect>; at: DOMRect; onAI?: () => void; onSpell?: (only?: string[]) => void; onClose: () => void;
}) {
  const [turn, setTurn] = useState(false);
  const top: string[] = sel.current().top;
  const turnable = top.length > 0 && top.every((id) => Array.isArray(editor.getBlock(id)?.content));
  const run = (fn: () => void) => () => { onClose(); try { fn(); } catch { /* selection gone */ } };
  const a = () => sel.actions.current;
  return (
    <Popover anchor={at} onClose={onClose} width={230}>
      {turn ? <>
        <MenuItem icon={<ChevronLeft size={15} />} onClick={() => setTurn(false)}>{t("Turn into")}</MenuItem>
        <MenuSep />
        {KINDS.map((k) => (
          <MenuItem key={k.key} icon={k.icon} onClick={run(() => a().turn(k.type, k.props || {}))}>{t(k.label)}</MenuItem>
        ))}
      </> : <>
        {onAI && <MenuItem icon={<Sparkles size={15} />} onClick={run(() => { onAI(); })}>{t("Ask {name}").replace("{name}", aiName())}</MenuItem>}
        {onSpell && <MenuItem icon={<SpellCheck size={15} />} onClick={run(() => onSpell(top))}>{t("Check spelling and grammar")}</MenuItem>}
        {turnable && <MenuItem icon={<Repeat2 size={15} />} right={<ChevronRight size={14} />} onClick={() => setTurn(true)}>{t("Turn into")}</MenuItem>}
        <MenuItem icon={<Copy size={15} />} onClick={run(() => a().duplicate())}>{t("Duplicate")}</MenuItem>
        <MenuItem icon={<ArrowUp size={15} />} onClick={run(() => a().move(true))}>{t("Move up")}</MenuItem>
        <MenuItem icon={<ArrowDown size={15} />} onClick={run(() => a().move(false))}>{t("Move down")}</MenuItem>
        <MenuSep />
        <MenuItem icon={<Scissors size={15} />} onClick={run(() => a().cut())}>{t("Cut")}</MenuItem>
        <MenuItem icon={<ClipboardCopy size={15} />} onClick={run(() => a().copy())}>{t("Copy")}</MenuItem>
        <MenuSep />
        <MenuItem danger icon={<Trash2 size={15} />} onClick={run(() => a().remove())}>{t("Delete")}</MenuItem>
      </>}
    </Popover>
  );
}
