import { useState } from "react";
import {
  blankPanel,
  type DataKind,
  type FieldCondition,
  type FilterField,
  identifiers,
  isTemporalField,
  type Panel,
  shelfName,
} from "../../../shared/console";
import { useQuery } from "../api";
import { useDictionary } from "./dictionary";
import { FilterShelf } from "./FilterShelf";

/** The fields a query over a kind of data can be narrowed or divided by. */
export function useQueryFields(
  data: DataKind,
  conditions: FieldCondition[] | undefined,
  end: string,
  minutes: number,
) {
  const dict = useDictionary();
  const observed = useQuery<string[]>("worksheetAttributes", {
    data: data === "daily" ? "request" : data,
    conditions: conditions?.filter((c) => c.field === "source"),
    end,
    minutes,
  });
  const fields: [FilterField, string][] = [
    ["time:60", "時刻"],
    ...identifiers.map((k): [FilterField, string] => [k, shelfName(k, dict)]),
  ];
  if (data === "daily")
    return fields.filter(([k]) => k === "source" || isTemporalField(k));
  for (const key of observed.data ?? [])
    fields.push([`attr:${key}`, shelfName(`attr:${key}`, dict)]);
  fields.push(["text", shelfName("text", dict)]);
  return fields;
}

/** Conditions shared by a page: every panel and row list there uses them. */
export function ConditionBar({
  data,
  conditions,
  minutes,
  end,
  change,
}: {
  data: DataKind;
  conditions: FieldCondition[];
  minutes: number;
  end: string;
  change: (conditions: FieldCondition[]) => void;
}) {
  const [open, setOpen] = useState<FilterField>();
  const fields = useQueryFields(data, conditions, end, minutes);
  const panel: Panel = { ...blankPanel, data, minutes, conditions };
  function write(field: FilterField, next?: FieldCondition) {
    const list = conditions.filter((c) => c.field !== field);
    const index = conditions.findIndex((c) => c.field === field);
    if (next) list.splice(index < 0 ? list.length : index, 0, next);
    change(list);
  }
  return (
    <div className="condition-bar">
      <FilterShelf
        panel={panel}
        end={end}
        items={conditions}
        fields={fields}
        open={open}
        setOpen={setOpen}
        add={(field) => {
          if (!conditions.some((c) => c.field === field))
            write(field, { field });
          setOpen(field);
        }}
        change={(c) => write(c.field, c)}
        changeTimeField={(previous, next) => {
          change([
            ...conditions.filter(
              (c) => c.field !== previous && c.field !== next.field,
            ),
            next,
          ]);
          setOpen(next.field);
        }}
        remove={(field) => {
          write(field);
          if (open === field) setOpen(undefined);
        }}
        ready={false}
        hover={false}
        compact
      />
    </div>
  );
}
