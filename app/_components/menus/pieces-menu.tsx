import { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { sideMenuStyles } from "@/_components/theme/styles";
import { VectorPattern, VectorTool } from "@/_hooks/use-vector-pattern";
import { MARKINGS, exportSvg } from "@/_lib/vector/layers";
import { LineWeight } from "@/_lib/line-weight";

function Chip({
  children,
  active = false,
  disabled = false,
  onClick,
  title,
  className,
}: {
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`${className ?? ""} px-2 py-1 rounded-md border text-xs font-medium transition-colors disabled:opacity-40 ${
        active
          ? "bg-purple-600 border-purple-600 text-white"
          : "border-purple-600 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-950"
      }`}
    >
      {children}
    </button>
  );
}

export default function PiecesMenu({
  vector,
  canStart,
  fileName,
  lineWeight,
  hidden,
}: {
  vector: VectorPattern;
  canStart: boolean;
  fileName: string;
  lineWeight: LineWeight;
  hidden: Set<string>;
}) {
  const t = useTranslations("PiecesMenu");
  const { status, enabled, doc, view, tool, selectedLayer: selected } = vector;

  const cutCount = doc.layers.filter((l) => l.cut).length;

  function download() {
    if (!vector.extract) return;
    const svg = exportSvg(vector.extract, doc, view, lineWeight, hidden);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(/\.[^.]+$/, "")}-pieces.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const tools: { key: VectorTool; label: string }[] = [
    { key: "move", label: t("toolMove") },
    { key: "lines", label: t("toolLines") },
    { key: "fold", label: t("toolFold") },
  ];

  return (
    <div
      className={`${sideMenuStyles} h-[calc(100vh-8rem)] overflow-y-auto scrollbar text-sm`}
    >
      <div className="flex w-full items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
        <h1 className="font-medium">{t("title")}</h1>
        <Chip
          active={vector.patternHidden}
          onClick={() => vector.setPatternHidden(!vector.patternHidden)}
          title={t("hidePatternHint")}
        >
          {vector.patternHidden ? t("showPattern") : t("hidePattern")}
        </Chip>
      </div>

      {!enabled && (
        <>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            {t("intro")}
          </p>
          <Chip disabled={!canStart} onClick={() => vector.setEnabled(true)}>
            {t("start")}
          </Chip>
        </>
      )}

      {enabled && status === "working" && <p>{t("working")}</p>}

      {enabled &&
        (status === "raster" || status === "empty" || status === "error") && (
          <>
            <p className="text-xs">{t(status)}</p>
            <div className="flex gap-1">
              <Chip onClick={() => vector.rerun()}>{t("tryAgain")}</Chip>
              <Chip onClick={() => vector.setEnabled(false)}>{t("stop")}</Chip>
            </div>
          </>
        )}

      {vector.ready && (
        <>
          <div className="flex flex-wrap gap-1">
            <Chip
              active={view.isolate}
              disabled={!selected}
              onClick={() =>
                vector.setView({ ...view, isolate: !view.isolate })
              }
              title={t("isolateHint")}
            >
              {t("isolate")}
            </Chip>
            <Chip
              active={view.showMarkings}
              onClick={() =>
                vector.setView({ ...view, showMarkings: !view.showMarkings })
              }
              title={t("markingsHint")}
            >
              {t("markings")}
            </Chip>
            <Chip onClick={vector.nextPiece}>{t("next")}</Chip>
          </div>

          <div className="w-full">
            <p className="text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t("tool")}
            </p>
            <div className="flex gap-1" role="radiogroup">
              {tools.map(({ key, label }) => (
                <Chip
                  key={key}
                  active={tool === key}
                  disabled={key === "fold" && !selected}
                  onClick={() => vector.setTool(key)}
                >
                  {label}
                </Chip>
              ))}
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
              {t(`${tool}Hint`)}
            </p>
          </div>

          {tool === "lines" && (
            <div className="w-full flex flex-col gap-1 border rounded-md p-2 border-gray-200 dark:border-gray-700">
              <p className="text-xs">
                {t("linesSelected", { count: vector.selectedItems.length })}
              </p>
              <select
                className="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-black p-1"
                value=""
                disabled={vector.selectedItems.length === 0}
                onChange={(e) =>
                  e.target.value &&
                  vector.moveItems(vector.selectedItems, e.target.value)
                }
              >
                <option value="">{t("moveTo")}</option>
                <option value="new">{t("newLayer")}</option>
                {doc.layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                <option value={MARKINGS}>{t("markings")}</option>
              </select>
              <Chip
                disabled={vector.selectedItems.length === 0}
                onClick={() => vector.setSelectedItems([])}
              >
                {t("clearSelection")}
              </Chip>
            </div>
          )}

          {selected && (
            <div className="w-full flex flex-col gap-1 border rounded-md p-2 border-purple-300 dark:border-purple-800">
              <input
                className="text-sm font-medium rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-black px-1"
                value={selected.name}
                aria-label={t("name")}
                onChange={(e) =>
                  vector.updateLayer(selected.id, { name: e.target.value })
                }
              />
              <div className="flex flex-wrap gap-1">
                {[-90, -5, -1, 1, 5, 90].map((deg) => (
                  <Chip
                    key={deg}
                    onClick={() => vector.rotateBy(selected.id, deg)}
                    title={t("rotateBy", { deg })}
                  >
                    {deg < 0 ? `⟲${-deg}°` : `⟳${deg}°`}
                  </Chip>
                ))}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                {t("angle", { deg: Math.round(selected.rotation * 10) / 10 })}
              </p>
              <div className="flex flex-wrap gap-1">
                <Chip
                  active={selected.flipped}
                  onClick={() => vector.flip(selected.id)}
                  title={t("mirrorHint")}
                >
                  {t("mirror")}
                </Chip>
                {selected.fold ? (
                  <Chip
                    active
                    onClick={() =>
                      vector.updateLayer(selected.id, { fold: null })
                    }
                  >
                    {t("refold")}
                  </Chip>
                ) : (
                  <Chip
                    active={tool === "fold"}
                    onClick={() => vector.setTool("fold")}
                    title={t("foldHint")}
                  >
                    {t("unfold")}
                  </Chip>
                )}
                <Chip onClick={() => vector.resetLayer(selected.id)}>
                  {t("resetPiece")}
                </Chip>
              </div>
              <div className="flex flex-wrap gap-1">
                <Chip
                  active={selected.cut}
                  onClick={() => vector.toggleCut(selected.id)}
                >
                  {selected.cut ? t("cut") : t("markCut")}
                </Chip>
                {!selected.cut && (
                  <Chip onClick={vector.cutAndNext}>{t("cutAndNext")}</Chip>
                )}
                {selected.piece < 0 && (
                  <Chip onClick={() => vector.deleteLayer(selected.id)}>
                    {t("deleteLayer")}
                  </Chip>
                )}
              </div>
            </div>
          )}

          <div className="w-full flex items-center justify-between">
            <p className="text-xs font-medium">
              {t("progress", { cut: cutCount, total: doc.layers.length })}
            </p>
            <Chip
              onClick={() =>
                vector.setAllVisible(!doc.layers.some((l) => l.visible))
              }
            >
              {doc.layers.some((l) => l.visible) ? t("hideAll") : t("showAll")}
            </Chip>
          </div>
          <ul className="w-full">
            {doc.layers.map((l) => (
              <li
                key={l.id}
                className={`flex items-center gap-2 rounded px-1 ${
                  l.id === view.selected
                    ? "bg-purple-100 dark:bg-purple-950"
                    : ""
                }`}
              >
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-purple-600"
                  checked={l.cut}
                  aria-label={t("markCut")}
                  title={t("markCut")}
                  onChange={() => vector.toggleCut(l.id)}
                />
                <button
                  type="button"
                  className={`flex-1 text-left py-2 truncate ${l.cut ? "line-through opacity-60" : ""} ${l.visible ? "" : "opacity-40"}`}
                  onClick={() =>
                    vector.select(l.id === view.selected ? null : l.id)
                  }
                >
                  {l.name}
                  {l.piece < 0 && (
                    <span className="ml-1 text-xs opacity-60">
                      {t("layerTag")}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="text-xs px-1 underline"
                  onClick={() => vector.toggleVisible(l.id)}
                >
                  {l.visible ? t("hide") : t("show")}
                </button>
              </li>
            ))}
          </ul>
          {doc.layers.length === 0 && (
            <p className="text-xs">{t("noPieces")}</p>
          )}

          <div className="flex flex-wrap gap-1 border-t border-gray-200 dark:border-gray-700 pt-2 w-full">
            <Chip onClick={download} title={t("exportHint")}>
              {t("export")}
            </Chip>
            <Chip onClick={() => vector.rerun()}>{t("findAgain")}</Chip>
            <Chip
              onClick={() => {
                if (window.confirm(t("resetAllConfirm"))) vector.resetAll();
              }}
            >
              {t("resetAll")}
            </Chip>
            <Chip onClick={() => vector.setEnabled(false)}>{t("stop")}</Chip>
          </div>
        </>
      )}
    </div>
  );
}
