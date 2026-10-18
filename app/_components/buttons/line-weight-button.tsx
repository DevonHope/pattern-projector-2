import React, { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconButton } from "@/_components/buttons/icon-button";
import Tooltip from "@/_components/tooltip/tooltip";
import { visible } from "@/_components/theme/css-functions";
import useOnClickOutside from "@/_hooks/use-on-click-outside";
import { LoadStatusEnum } from "@/_lib/load-status-enum";
import LoadingSpinner from "@/_icons/loading-spinner";
import {
  DEFAULT_LINE_WEIGHT,
  LINE_MIN_MM_OPTIONS,
  LINE_SCALE_MAX,
  LINE_SCALE_MIN,
  LINE_SCALE_STEP,
  LineWeight,
} from "@/_lib/line-weight";

const PIXEL_THICKEN_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7];

export default function LineWeightButton({
  icon,
  lineWeight,
  setLineWeight,
  lineThickness,
  setLineThickness,
  loadStatus,
}: {
  icon: React.ReactNode;
  lineWeight: LineWeight;
  setLineWeight: (lw: LineWeight) => void;
  lineThickness: number;
  setLineThickness: (n: number) => void;
  loadStatus?: LoadStatusEnum;
}) {
  const t = useTranslations("LineWeightMenu");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(containerRef, () => setIsOpen(false));

  const loading = loadStatus === LoadStatusEnum.LOADING;
  const labelClass = "text-sm font-medium text-gray-700 dark:text-gray-200";
  const selectClass =
    "w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-800 dark:text-gray-100";

  return (
    <div className="relative inline-block" ref={containerRef}>
      {loading ? (
        <LoadingSpinner className="absolute top-3.5 m-auto left-0 right-0 h-4 w-4 z-10" />
      ) : null}
      <Tooltip description={t("title")} disabled={isOpen || loading}>
        <IconButton
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="true"
          aria-expanded={isOpen}
          className={loading ? "text-gray-700" : ""}
        >
          {icon}
        </IconButton>
      </Tooltip>
      <div
        className={`absolute -left-5 mt-2 w-72 p-4 flex flex-col gap-4 bg-white dark:bg-gray-800 rounded-md shadow-lg ${visible(isOpen)}`}
        role="dialog"
        aria-label={t("title")}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="line-scale" className={labelClass}>
            {t("scale")}: {lineWeight.scale.toFixed(2)}×
          </label>
          <input
            id="line-scale"
            type="range"
            min={LINE_SCALE_MIN}
            max={LINE_SCALE_MAX}
            step={LINE_SCALE_STEP}
            value={lineWeight.scale}
            onChange={(e) =>
              setLineWeight({ ...lineWeight, scale: Number(e.target.value) })
            }
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("scaleHelp")}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="line-min" className={labelClass}>
            {t("minimum")}
          </label>
          <select
            id="line-min"
            className={selectClass}
            value={lineWeight.minMm}
            onChange={(e) =>
              setLineWeight({ ...lineWeight, minMm: Number(e.target.value) })
            }
          >
            {LINE_MIN_MM_OPTIONS.map((mm) => (
              <option key={mm} value={mm}>
                {mm === 0 ? t("off") : `${mm} mm`}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("minimumHelp")}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="line-thicken" className={labelClass}>
            {t("thicken")}
          </label>
          <select
            id="line-thicken"
            className={selectClass}
            value={lineThickness}
            onChange={(e) => setLineThickness(Number(e.target.value))}
          >
            {PIXEL_THICKEN_OPTIONS.map((px) => (
              <option key={px} value={px}>
                {px}px
              </option>
            ))}
          </select>
        </div>

        <button
          className="self-end text-sm text-blue-700 dark:text-blue-300 hover:underline"
          onClick={() => {
            setLineWeight(DEFAULT_LINE_WEIGHT);
            setLineThickness(0);
          }}
        >
          {t("reset")}
        </button>
      </div>
    </div>
  );
}
