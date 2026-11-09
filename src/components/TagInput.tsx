import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Tag } from '../types';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, Search, Plus, Tag as TagIcon, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ENABLE_PREMIUM_BETA } from '../lib/permissions';
import { logger } from '../lib/logger';

interface TagInputProps {
  selectedTagIds: string[];
  allTags: Tag[];
  onAddTag: (tagName: string) => void | Promise<Tag | void>;
  onSelectTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  placeholder?: string;
  canAddTag?: boolean;
}

export const TagInput: React.FC<TagInputProps> = React.memo(({
  selectedTagIds,
  allTags,
  onAddTag,
  onSelectTag,
  onRemoveTag,
  placeholder = "輸入標籤或選擇既有標籤...",
  canAddTag = true
}) => {
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedTags = useMemo(() => 
    selectedTagIds.map(id => allTags.find(t => t.id === id)).filter(Boolean) as Tag[],
    [selectedTagIds, allTags]
  );

  const suggestions = useMemo(() => {
    const filtered = allTags.filter(tag => 
      !selectedTagIds.includes(tag.id) &&
      tag.name.toLowerCase().includes(input.toLowerCase())
    );
    return filtered;
  }, [allTags, selectedTagIds, input]);

  const exactMatch = useMemo(() => 
    allTags.find(t => t.name.toLowerCase() === input.toLowerCase().trim()),
    [allTags, input]
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && suggestions.length > 0 && activeIndex >= 0) {
        onSelectTag(suggestions[activeIndex].id);
        setInput('');
        setIsOpen(false);
      } else if (input.trim()) {
        if (exactMatch) {
          if (!selectedTagIds.includes(exactMatch.id)) {
            onSelectTag(exactMatch.id);
          }
        } else if (canAddTag) {
          onAddTag(input.trim());
        }
        setInput('');
        setIsOpen(false);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIsOpen(true);
      setActiveIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'Backspace' && !input && selectedTagIds.length > 0) {
      onRemoveTag(selectedTagIds[selectedTagIds.length - 1]);
    }
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="flex flex-wrap gap-2 p-2 min-h-[42px] max-h-[160px] overflow-y-auto bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-lg focus-within:ring-2 focus-within:ring-neutral-400 transition-all" style={{ WebkitOverflowScrolling: 'touch' }}>
        {selectedTags.map(tag => (
          <span 
            key={tag.id} 
            className="inline-flex items-center gap-1 px-2 py-1 bg-neutral-100 dark:bg-neutral-800 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 group"
          >
            <TagIcon size={10} className="text-neutral-400" />
            {tag.name}
            <button 
              type="button" 
              onClick={() => onRemoveTag(tag.id)} 
              className="text-neutral-400 hover:text-red-500 transition-colors"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={input}
          maxLength={10}
          onChange={(e) => {
            const val = e.target.value.slice(0, 10);
            setInput(val);
            setIsOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={selectedTagIds.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-sm placeholder:text-neutral-400"
        />
      </div>

      {isOpen && (input.trim() || suggestions.length > 0) && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in duration-150">
          <div className="flex flex-col max-h-[320px]">
            {/* Search result count or mode indicator if needed */}
            <ScrollArea className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
              <div className="p-1 pr-3">
                {suggestions.map((tag, index) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => {
                      onSelectTag(tag.id);
                      setInput('');
                      setIsOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm rounded-md flex items-center justify-between transition-colors",
                      index === activeIndex ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <TagIcon size={12} className="text-neutral-400" />
                      <span>{tag.name}</span>
                    </div>
                    <span className="text-[10px] text-neutral-500 uppercase">點擊選擇</span>
                  </button>
                ))}
                
                {input.trim() && !exactMatch && (
                  <button
                    type="button"
                    disabled={!canAddTag}
                    onClick={() => {
                      if (canAddTag) {
                        onAddTag(input.trim());
                        setInput('');
                        setIsOpen(false);
                      }
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm rounded-md flex items-center justify-between transition-colors sticky bottom-0 bg-card border-t border-border",
                      !canAddTag && !ENABLE_PREMIUM_BETA ? "opacity-50 cursor-not-allowed" : "text-blue-500",
                      suggestions.length === 0 ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Plus size={14} />
                      <span className="font-bold">建立新標籤 "{input.trim()}"</span>
                    </div>
                    {!canAddTag && !ENABLE_PREMIUM_BETA && <Lock size={12} className="text-neutral-500" />}
                  </button>
                )}

                {input.trim() && suggestions.length === 0 && !exactMatch && (
                  <div className="px-3 py-4 text-center text-xs text-neutral-500 italic">
                    {canAddTag ? "按 Enter 建立新標籤" : "請從現有標籤中選擇"}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
});
