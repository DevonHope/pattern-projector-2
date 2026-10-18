import { useContext } from "react";
import { createContext } from "react";
import { Layers } from "@/_lib/layers";
import { DEFAULT_LINE_WEIGHT, LineWeight } from "@/_lib/line-weight";

export interface RenderContextType {
  erosions: number;
  lineWeight: LineWeight;
  layers: Layers;
  magnifying: boolean;
  onPageRenderSuccess: () => void;
  patternScale: number;
}

export const RenderContext = createContext<RenderContextType>({
  erosions: 0,
  lineWeight: DEFAULT_LINE_WEIGHT,
  layers: {},
  magnifying: false,
  onPageRenderSuccess: () => {},
  patternScale: 1,
});

export default function useRenderContext() {
  return useContext(RenderContext);
}
