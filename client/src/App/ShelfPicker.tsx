import { useEffect, useRef, useState } from "react";

export function ShelfPicker({
  label,
  choices,
  select,
  close,
}: {
  label: string;
  choices: [string, string][];
  select: (value: string) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, search] = useState("");
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    searchInput.current?.focus();
    return () => el?.close();
  }, []);
  const matches = choices.filter(([key, name]) =>
    (key + " " + name).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <dialog
      className="shelf-picker"
      ref={dialog}
      aria-label={label + "に追加"}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="options-heading">
        <h3>{label}に追加</h3>
        <button type="button" onClick={close}>
          閉じる
        </button>
      </div>
      {choices.length > 0 && (
        <>
          <label>
            フィールドを検索
            <input
              ref={searchInput}
              type="search"
              value={query}
              onChange={(e) => search(e.target.value)}
            />
          </label>
          <div className="picker-list">
            {matches.map(([key, name]) => (
              <button
                type="button"
                key={key}
                onClick={() => {
                  select(key);
                  close();
                }}
              >
                {name}
              </button>
            ))}
            {!matches.length && <small>一致するフィールドがありません。</small>}
          </div>
        </>
      )}
    </dialog>
  );
}
