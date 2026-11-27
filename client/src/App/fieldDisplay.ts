import {
  compatibleUnits,
  convertUnit,
  type Dictionary,
  fieldKey,
  fieldMeta,
  fieldZone,
  isTimeField,
  type Panel,
  type Point,
  type ShelfAxis,
  shelfFields,
  type Value,
  valueAt,
  valueKey,
  valueName,
  valueUnit,
} from "../../../shared/console";

/** The unit a value's numbers are in before any display conversion. */
export function nativeUnit(
  dict: Dictionary,
  panel: Panel,
  v: Value = panel.values[0],
) {
  return valueUnit(dict, panel.data, v);
}
/**
 * The unit a value is shown in: the panel's choice, else the field's
 * preferred unit when it converts, else its own.
 */
export function shownUnit(
  dict: Dictionary,
  panel: Panel,
  v: Value,
  source = nativeUnit(dict, panel, v),
) {
  const family = compatibleUnits(source);
  const fits = (u?: string) => !!u && !!family && Object.hasOwn(family, u);
  const chosen = panel.fieldUnits?.[valueKey(v)];
  if (fits(chosen)) return chosen as string;
  const preferred =
    v.of.length === 1 && v.agg !== "count" && v.agg !== "distinct"
      ? fieldMeta(dict, fieldKey(panel.data, v.of[0])).display
      : undefined;
  return fits(preferred) ? (preferred as string) : source;
}
export { compatibleUnits };
export function displayPoints(dict: Dictionary, panel: Panel, points: Point[]) {
  const pivot = panel.pivot;
  const row = shelfFields(pivot?.row).indexOf("measure");
  const col = shelfFields(pivot?.column).indexOf("measure");
  return points.map((p) => {
    const key =
      row >= 0
        ? (p.rowPath ?? [p.series])[row]
        : col >= 0
          ? (p.columnPath ?? [p.column])[col]
          : undefined;
    const v = valueAt(panel, key);
    const source = p.metricUnit || nativeUnit(dict, panel, v);
    const unit = shownUnit(dict, panel, v, source);
    return {
      ...p,
      metricUnit: unit,
      value: unit === source ? p.value : convertUnit(p.value, source, unit),
    };
  });
}
const timeFormat = (timeZone: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
const dateFormats = { JST: timeFormat("Asia/Tokyo"), UTC: timeFormat("UTC") };
export function displayField(
  dict: Dictionary,
  panel: Panel,
  field: ShelfAxis,
  value: string,
) {
  if (field === "measure")
    return valueName(dict, panel.data, valueAt(panel, value));
  if (isTimeField(field) && Number.isFinite(Date.parse(value))) {
    if (field === "time:86400")
      return new Date(value).toISOString().slice(0, 10);
    return dateFormats[fieldZone(panel.pivot, field)].format(new Date(value));
  }
  return value;
}
