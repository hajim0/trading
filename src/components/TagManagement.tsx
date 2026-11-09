import React, { useState } from 'react';
import { Tag } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tag as TagIcon, Edit2, Trash2, Check, X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TagManagementProps {
  tags: Tag[];
  onRenameTag: (id: string, newName: string) => void;
  onDeleteTag: (id: string) => void;
  onAddTag: (name: string) => void;
}

export const TagManagement: React.FC<TagManagementProps> = ({
  tags,
  onRenameTag,
  onDeleteTag,
  onAddTag
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [search, setSearch] = useState('');
  const [newTagName, setNewTagName] = useState('');

  const filteredTags = tags.filter(t => 
    t.name.toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => a.name.localeCompare(b.name));

  const handleStartEdit = (tag: Tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setDeletingId(null);
  };

  const handleSave = () => {
    if (editingId && editName.trim()) {
      onRenameTag(editingId, editName.trim());
      setEditingId(null);
    }
  };

  const handleAddTag = () => {
    if (newTagName.trim()) {
      onAddTag(newTagName.trim());
      setNewTagName('');
    }
  };

  const handleDelete = (id: string) => {
    onDeleteTag(id);
    setDeletingId(null);
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">標籤管理系統</h2>
          <p className="text-neutral-500 text-sm mt-1">管理全域標籤庫，重新命名將同步更新所有交易紀錄。</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Input
            placeholder="輸入新標籤名稱..."
            value={newTagName}
            maxLength={10}
            onChange={(e) => setNewTagName(e.target.value.slice(0, 10))}
            className="w-full md:w-64 bg-white text-black border-neutral-200"
            onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
          />
          <Button onClick={handleAddTag} className="bg-black text-white hover:bg-neutral-800">
            新增標籤
          </Button>
        </div>
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="p-4 border-b border-border">
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" size={16} />
            <Input
              placeholder="搜尋標籤..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-white text-black border-neutral-200"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {filteredTags.map(tag => (
              <div key={tag.id} className="flex items-center justify-between p-4 hover:bg-neutral-50 dark:hover:bg-neutral-900/30 transition-colors">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                    <TagIcon size={14} className="text-neutral-500" />
                  </div>
                  
                  {editingId === tag.id ? (
                    <div className="flex items-center gap-2 flex-1 max-w-md">
                      <Input
                        value={editName}
                        maxLength={10}
                        onChange={(e) => setEditName(e.target.value.slice(0, 10))}
                        className="h-8 bg-white text-black"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSave();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                      />
                      <Button size="sm" variant="ghost" onClick={handleSave} className="h-8 w-8 p-0 text-green-500">
                        <Check size={16} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-8 w-8 p-0 text-neutral-400">
                        <X size={16} />
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <div className="font-medium text-sm">{tag.name}</div>
                      <div className="text-[10px] text-neutral-500 uppercase font-mono">建立於 {new Date(tag.createdAt).toLocaleDateString()}</div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {deletingId === tag.id ? (
                    <div className="flex items-center gap-2 bg-red-500/10 p-1 rounded-lg border border-red-500/20">
                      <span className="text-[10px] font-bold text-red-500 px-2 uppercase">確定刪除？</span>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleDelete(tag.id)}
                        className="h-7 px-2 text-[10px] font-bold bg-red-500 text-white hover:bg-red-600"
                      >
                        確認
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setDeletingId(null)}
                        className="h-7 px-2 text-[10px] font-bold text-neutral-400 hover:text-white"
                      >
                        取消
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleStartEdit(tag)}
                        className="h-8 w-8 p-0 text-neutral-400 hover:text-white"
                        disabled={editingId !== null}
                      >
                        <Edit2 size={14} />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => {
                          setDeletingId(tag.id);
                          setEditingId(null);
                        }}
                        className="h-8 w-8 p-0 text-neutral-400 hover:text-red-500"
                        disabled={editingId !== null}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}

            {filteredTags.length === 0 && (
              <div className="py-20 text-center text-neutral-500 italic text-sm">
                {search ? "找不到相符的標籤" : "目前尚無標籤，請在新增交易時建立"}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
