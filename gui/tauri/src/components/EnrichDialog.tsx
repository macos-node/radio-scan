import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { setEnrich, type Enrich, type Harvest, type Sub } from "../lib/podcasts";
import { cn } from "../lib/cn";

/** The fields a user can fill in, in the order they read. `label` is the field's
 *  name; `hint` explains what it is for when the name alone is thin. */
const FIELDS = [
  { key: "author", label: "Author", hint: "Who makes the show" },
  { key: "website", label: "Website", hint: "" },
  { key: "ownerEmail", label: "Contact email", hint: "" },
  { key: "language", label: "Language", hint: "e.g. en, it" },
  { key: "copyright", label: "Copyright", hint: "" },
  { key: "categories", label: "Categories", hint: "Comma separated" },
  { key: "description", label: "Description", hint: "" },
] as const;

type Key = (typeof FIELDS)[number]["key"];

const asText = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? v.join(", ") : (v ?? "");

/** Fill in what a feed leaves out.
 *
 *  The rule this screen has to make visible: **the feed always wins**. A field the
 *  show states itself is shown greyed with the feed's value, and anything typed
 *  there is kept but not displayed — dormant, ready if the feed ever stops saying
 *  it. Without that being explicit, typing into such a field and seeing no change
 *  looks broken rather than intended. */
export function EnrichDialog({
  sub,
  feed,
  onClose,
}: {
  sub: Sub;
  /** What the feed states right now (stored harvest merged with any live fetch). */
  feed: Partial<Harvest>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<Key, string>>(() =>
    Object.fromEntries(
      FIELDS.map((f) => [f.key, asText(sub.enrich?.[f.key])]),
    ) as Record<Key, string>,
  );
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => firstRef.current?.focus(), []);

  const save = () => {
    const next: Partial<Enrich> = {
      author: values.author,
      website: values.website,
      ownerEmail: values.ownerEmail,
      language: values.language,
      copyright: values.copyright,
      description: values.description,
      categories: values.categories ? values.categories.split(",") : [],
    };
    setEnrich(sub.url, next);
    onClose();
  };

  const clearAll = () => {
    setEnrich(sub.url, {});
    onClose();
  };

  const hasAny = Object.values(values).some((v) => v.trim());

  return (
    <Modal title={`Fill in — ${sub.title}`} onClose={onClose}>
      <p className="mb-3 text-xs text-muted">
        Your own notes about this show. They are kept separately from what the feed
        publishes and are never overwritten by it — but the feed wins wherever it
        says something, so these fill the gaps.
      </p>
      <div className="flex max-h-[52vh] flex-col gap-2.5 overflow-y-auto pr-1">
        {FIELDS.map((f, i) => {
          const stated = feed[f.key];
          const feedSays = Array.isArray(stated)
            ? stated.length > 0
              ? stated.join(", ")
              : ""
            : (stated ?? "");
          return (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="flex items-baseline gap-2">
                <span className="text-xs text-fg">{f.label}</span>
                {f.hint && (
                  <span className="text-[10px] text-muted/70">{f.hint}</span>
                )}
              </span>
              <input
                ref={i === 0 ? firstRef : undefined}
                value={values[f.key]}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.key]: e.target.value }))
                }
                placeholder={feedSays ? "—" : `Add ${f.label.toLowerCase()}…`}
                spellCheck={false}
                className={cn(
                  "rounded-sm border border-surface bg-surface px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent",
                  feedSays && "opacity-60",
                )}
              />
              {feedSays && (
                <span className="text-[10px] text-muted/70">
                  The feed says “{feedSays.slice(0, 80)}” — yours stays stored and
                  shows only if the feed stops.
                </span>
              )}
            </label>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        {sub.enrich && (
          <button
            type="button"
            onClick={clearAll}
            className="mr-auto rounded-sm border border-surface px-3 py-1.5 text-xs text-muted transition-colors hover:border-alert hover:text-alert"
          >
            Clear all
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm border border-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surfaceHover hover:text-fg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!hasAny && !sub.enrich}
          className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
