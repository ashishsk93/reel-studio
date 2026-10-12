import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * Local, editable state that resets from `init()` whenever `source` changes (for example a form
 * over server data that a refetch replaced). Adjusts state during render, as React recommends,
 * instead of syncing in an effect.
 */
export function useSyncedState<T>(source: unknown, init: () => T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(init);
  const [previous, setPrevious] = useState(source);
  if (previous !== source) {
    setPrevious(source);
    setState(init());
  }
  return [state, setState];
}
