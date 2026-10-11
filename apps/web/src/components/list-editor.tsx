"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/page-header";

/** Edits a list of short strings, one input per item. */
export function ListEditor({
  value,
  onChange,
  placeholder,
  addLabel = "Add",
  errors = {},
  errorPrefix,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  errors?: Record<string, string>;
  errorPrefix?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {value.map((item, i) => (
        <div key={i}>
          <div className="flex gap-2">
            <Input
              value={item}
              placeholder={placeholder}
              onChange={(e) => onChange(value.map((v, j) => (j === i ? e.target.value : v)))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <X />
            </Button>
          </div>
          {errorPrefix && <FieldError message={errors[`${errorPrefix}.${i}`]} />}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange([...value, ""])}>
        <Plus /> {addLabel}
      </Button>
    </div>
  );
}
