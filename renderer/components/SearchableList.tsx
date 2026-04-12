import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface SearchableListProps<T> {
  items: T[];
  labelKey: keyof T;
  searchKeys: (keyof T)[];
  onSelect: (item: T) => void;
  placeholder?: string;
  renderItem?: (item: T, isActive: boolean) => React.ReactNode;
  loading?: boolean;
}

export function SearchableList<T>({
  items,
  labelKey,
  searchKeys,
  onSelect,
  placeholder = 'Search...',
  renderItem,
  loading = false,
}: SearchableListProps<T>) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = items.filter((item) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return searchKeys.some((key) => {
      const val = item[key];
      if (typeof val === 'string') return val.toLowerCase().includes(q);
      if (typeof val === 'number') return String(val).includes(q);
      return false;
    });
  });

  // Reset active index when query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.children[activeIndex] as HTMLElement | undefined;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filtered[activeIndex]) {
            onSelect(filtered[activeIndex]);
          }
          break;
      }
    },
    [filtered, activeIndex, onSelect]
  );

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const defaultRenderItem = (item: T, isActive: boolean) => (
    <span className="sl-item-label">{String(item[labelKey])}</span>
  );

  return (
    <div className="searchable-list" onKeyDown={handleKeyDown}>
      <input
        ref={inputRef}
        className="sl-input"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
      />
      <div className="sl-list" ref={listRef}>
        {loading ? (
          <div className="sl-loading">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="sl-empty">No matches</div>
        ) : (
          filtered.map((item, i) => (
            <div
              key={i}
              className={`sl-item${i === activeIndex ? ' active' : ''}`}
              onClick={() => onSelect(item)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {(renderItem ?? defaultRenderItem)(item, i === activeIndex)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
