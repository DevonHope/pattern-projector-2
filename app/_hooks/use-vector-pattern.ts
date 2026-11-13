import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayerDoc,
  MARKINGS,
  PieceLayer,
  SavedDoc,
  ViewState,
  initialDoc,
  itemsByLayer,
  layerBounds,
  restoreDoc,
  toSaved,
} from "@/_lib/vector/layers";
import { Segmentation, segment } from "@/_lib/vector/segment";
import { ExtractResult, VectorItem } from "@/_lib/vector/types";

export type VectorStatus =
  | "idle"
  | "working"
  | "ready"
  | "empty"
  | "raster"
  | "error";

export type VectorTool = "move" | "lines" | "fold";

export type VectorSource = () => Promise<ExtractResult | null>;

interface SavedState extends SavedDoc {
  view: ViewState;
}

const EMPTY_DOC: LayerDoc = { layers: [], owner: {} };
const DEFAULT_VIEW: ViewState = {
  isolate: false,
  selected: null,
  showMarkings: true,
};

function storageKey(fileName: string) {
  return `vectorLayers:${fileName}`;
}

function loadSaved(fileName: string): SavedState | null {
  try {
    const s = localStorage.getItem(storageKey(fileName));
    return s ? (JSON.parse(s) as SavedState) : null;
  } catch {
    return null;
  }
}

export function useVectorPattern({
  fileName,
  sig,
  source,
  pieceLabel,
  layerLabel,
}: {
  fileName: string | null;
  // Changes whenever the pattern's layout changes (pages, stitching, scale).
  sig: string;
  source: VectorSource;
  pieceLabel: (n: number) => string;
  layerLabel: (n: number) => string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<VectorStatus>("idle");
  const [extract, setExtract] = useState<ExtractResult | null>(null);
  const [seg, setSeg] = useState<Segmentation | null>(null);
  const [doc, setDoc] = useState<LayerDoc>(EMPTY_DOC);
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const [tool, setTool] = useState<VectorTool>("move");
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [patternHidden, setPatternHidden] = useState(false);
  const freshRef = useRef<LayerDoc>(EMPTY_DOC);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const labelsRef = useRef({ pieceLabel, layerLabel });
  labelsRef.current = { pieceLabel, layerLabel };
  const runRef = useRef(0);

  const run = useCallback(async () => {
    if (!fileName) return;
    const runId = ++runRef.current;
    setStatus("working");
    // Let the panel show progress before the heavy lifting starts.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const result = await sourceRef.current();
      if (runId !== runRef.current) return;
      if (!result) {
        setStatus("error");
        return;
      }
      const vectorCount = result.items.filter((i) => i.kind !== "text").length;
      const s = segment(
        result.items,
        result.width,
        result.height,
        result.pages,
      );
      const fresh = initialDoc(result, s, labelsRef.current.pieceLabel);
      freshRef.current = fresh;
      const saved = loadSaved(fileName);
      setExtract(result);
      setSeg(s);
      setDoc(restoreDoc(fresh, saved, sig));
      setView(saved && saved.sig === sig ? saved.view : DEFAULT_VIEW);
      setSelectedItems([]);
      setTool("move");
      if (vectorCount === 0) {
        setStatus(result.imageCount > 0 ? "raster" : "empty");
      } else {
        setStatus("ready");
      }
    } catch (e) {
      console.error("Could not read pattern vectors", e);
      if (runId === runRef.current) setStatus("error");
    }
  }, [fileName, sig]);

  // New file: start over.
  useEffect(() => {
    runRef.current++;
    setEnabled(false);
    setStatus("idle");
    setExtract(null);
    setSeg(null);
    setDoc(EMPTY_DOC);
    setView(DEFAULT_VIEW);
    setPatternHidden(false);
  }, [fileName]);

  // Re-read when switched on and whenever the layout changes.
  useEffect(() => {
    if (enabled) run();
  }, [enabled, run]);

  // Remember progress (debounced).
  useEffect(() => {
    if (status !== "ready" || !fileName) return;
    const t = setTimeout(() => {
      try {
        const saved: SavedState = {
          ...toSaved(doc, freshRef.current, sig),
          view,
        };
        localStorage.setItem(storageKey(fileName), JSON.stringify(saved));
      } catch {
        // Storage full or blocked: progress just isn't remembered.
      }
    }, 300);
    return () => clearTimeout(t);
  }, [doc, view, status, fileName, sig]);

  // Only regroup when lines change owner or layers come and go, not on every
  // move/rotate, so dragging a piece doesn't rebuild every layer's markup.
  const layerIds = doc.layers.map((l) => l.id).join("\n");
  const owner = doc.owner;
  const byLayer = useMemo(
    () =>
      itemsByLayer(
        layerIds ? layerIds.split("\n") : [],
        owner,
        extract?.items ?? [],
      ),
    [layerIds, owner, extract],
  );

  const updateLayer = useCallback(
    (id: string, patch: Partial<PieceLayer>) =>
      setDoc((d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      })),
    [],
  );

  const changeLayer = useCallback(
    (id: string, change: (l: PieceLayer) => Partial<PieceLayer>) =>
      setDoc((d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === id ? { ...l, ...change(l) } : l)),
      })),
    [],
  );

  const select = useCallback((id: string | null) => {
    setView((v) => ({ ...v, selected: id }));
  }, []);

  const rotateBy = useCallback(
    (id: string, degrees: number) =>
      changeLayer(id, (l) => ({
        rotation: (((l.rotation + degrees) % 360) + 360) % 360,
      })),
    [changeLayer],
  );

  const flip = useCallback(
    (id: string) => changeLayer(id, (l) => ({ flipped: !l.flipped })),
    [changeLayer],
  );

  const toggleCut = useCallback(
    (id: string) => changeLayer(id, (l) => ({ cut: !l.cut })),
    [changeLayer],
  );

  const toggleVisible = useCallback(
    (id: string) => changeLayer(id, (l) => ({ visible: !l.visible })),
    [changeLayer],
  );

  const resetLayer = useCallback(
    (id: string) =>
      updateLayer(id, {
        dx: 0,
        dy: 0,
        rotation: 0,
        flipped: false,
        fold: null,
      }),
    [updateLayer],
  );

  const resetAll = useCallback(() => {
    setDoc(freshRef.current);
    setView(DEFAULT_VIEW);
    setSelectedItems([]);
  }, []);

  const setAllVisible = useCallback((visible: boolean) => {
    setDoc((d) => ({
      ...d,
      layers: d.layers.map((l) => ({ ...l, visible })),
    }));
  }, []);

  const toggleItem = useCallback((id: number) => {
    setSelectedItems((s) =>
      s.includes(id) ? s.filter((i) => i !== id) : [...s, id],
    );
  }, []);

  // Move lines to another layer, or to a new one ("new").
  const moveItems = useCallback(
    (ids: number[], target: string) => {
      if (!extract || ids.length === 0) return;
      setDoc((d) => {
        let layers = d.layers;
        let to = target;
        if (target === "new") {
          const items = ids
            .map((i) => extract.items[i])
            .filter((i): i is VectorItem => !!i);
          const b = layerBounds(items) ?? [0, 0, 0, 0];
          const from = layers.find((l) => l.id === d.owner[ids[0]]);
          const n = layers.filter((l) => l.piece < 0).length + 1;
          to = `layer:${Date.now().toString(36)}`;
          // Start with the same placement as where the lines came from so
          // they don't jump.
          const newLayer: PieceLayer = {
            id: to,
            name: labelsRef.current.layerLabel(n),
            visible: true,
            cut: false,
            cx: from?.cx ?? (b[0] + b[2]) / 2,
            cy: from?.cy ?? (b[1] + b[3]) / 2,
            dx: from?.dx ?? 0,
            dy: from?.dy ?? 0,
            rotation: from?.rotation ?? 0,
            flipped: from?.flipped ?? false,
            fold: null,
            piece: -1,
          };
          layers = [...layers, newLayer];
          setView((v) => ({ ...v, selected: to }));
        }
        const owner = { ...d.owner };
        for (const i of ids) owner[i] = to;
        return { layers, owner };
      });
      setSelectedItems([]);
    },
    [extract],
  );

  const deleteLayer = useCallback((id: string) => {
    setDoc((d) => {
      const owner = { ...d.owner };
      for (const [item, layer] of Object.entries(owner)) {
        if (layer === id) owner[Number(item)] = MARKINGS;
      }
      return { layers: d.layers.filter((l) => l.id !== id), owner };
    });
    setView((v) => (v.selected === id ? { ...v, selected: null } : v));
  }, []);

  // Select the next piece that isn't cut yet (wrapping around).
  const nextPiece = useCallback(() => {
    const layers = doc.layers.filter((l) => l.visible);
    if (layers.length === 0) return;
    const start = layers.findIndex((l) => l.id === view.selected);
    for (let k = 1; k <= layers.length; k++) {
      const l = layers[(start + k + layers.length) % layers.length];
      if (!l.cut) {
        select(l.id);
        return;
      }
    }
  }, [doc.layers, view.selected, select]);

  const cutAndNext = useCallback(() => {
    if (!view.selected) return;
    updateLayer(view.selected, { cut: true });
    const layers = doc.layers.filter((l) => l.visible);
    const start = layers.findIndex((l) => l.id === view.selected);
    for (let k = 1; k < layers.length; k++) {
      const l = layers[(start + k) % layers.length];
      if (!l.cut) {
        select(l.id);
        return;
      }
    }
  }, [doc.layers, view.selected, select, updateLayer]);

  const ready = enabled && status === "ready";
  const selectedLayer = doc.layers.find((l) => l.id === view.selected) ?? null;

  return {
    enabled,
    setEnabled,
    status,
    ready,
    rerun: run,
    extract,
    seg,
    doc,
    view,
    setView,
    tool,
    setTool,
    selectedItems,
    setSelectedItems,
    toggleItem,
    patternHidden,
    setPatternHidden,
    byLayer,
    selectedLayer,
    select,
    updateLayer,
    rotateBy,
    flip,
    toggleCut,
    toggleVisible,
    resetLayer,
    resetAll,
    setAllVisible,
    moveItems,
    deleteLayer,
    nextPiece,
    cutAndNext,
  };
}

export type VectorPattern = ReturnType<typeof useVectorPattern>;
