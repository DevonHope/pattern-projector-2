import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import useOnClickOutside from "@/_hooks/use-on-click-outside";
import { visible } from "@/_components/theme/css-functions";
import CheckIcon from "@/_icons/check-icon";
import ExpandMoreIcon from "@/_icons/expand-more-icon";
import {
  MAT_PRESET_GROUPS,
  MatPreset,
  findMatchingPreset,
  presetCalibration,
  presetDimensions,
} from "@/_lib/mat-presets";

/**
 * Dropdown of common mat/paper sizes for the calibration grid. Each option
 * shows its name with the dimensions in small text beside it.
 */
export default function MatPresetSelect({
  widthInput,
  heightInput,
  unitOfMeasure,
  onSelect,
}: {
  widthInput: string;
  heightInput: string;
  unitOfMeasure: string;
  onSelect: (width: string, height: string, unitOfMeasure: string) => void;
}) {
  const t = useTranslations("MatPresets");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(containerRef, () => setIsOpen(false));

  const current = findMatchingPreset(widthInput, heightInput, unitOfMeasure);

  function choose(p: MatPreset) {
    const c = presetCalibration(p);
    onSelect(c.width, c.height, c.unitOfMeasure);
    setIsOpen(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        id="mat_preset"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={t("tooltip")}
        onClick={() => setIsOpen(!isOpen)}
        className="h-11 flex items-center gap-0.5 pl-2 pr-0.5 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-black dark:border-gray-600 dark:text-white dark:focus:ring-blue-800 dark:focus:border-blue-800 whitespace-nowrap"
      >
        <span className="max-w-[4.5rem] lg:max-w-[7rem] truncate">
          {current ? current.label : t("preset")}
        </span>
        <ExpandMoreIcon ariaLabel="" />
      </button>
      <div
        role="listbox"
        aria-labelledby="mat_preset"
        className={`absolute right-0 mt-2 w-72 max-h-[70vh] overflow-y-auto py-1 bg-white dark:bg-gray-800 rounded-md shadow-lg z-20 ${visible(isOpen)}`}
      >
        {MAT_PRESET_GROUPS.map((group) => (
          <div key={group.id} role="group" aria-label={t(group.id)}>
            <div className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t(group.id)}
            </div>
            {group.presets.map((p) => {
              const selected = current?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => choose(p)}
                  className="w-full grid grid-cols-[20px_1fr_auto] items-center gap-2 px-4 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-700"
                >
                  <span>{selected && <CheckIcon ariaLabel="" />}</span>
                  <span>{p.label}</span>
                  <small className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                    {presetDimensions(p)}
                  </small>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
