import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Edit2, Play, Loader2, Search, Star, Check, Film, Tv, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { useToast } from '../ui/Toast';
import { Skeleton } from '../ui/Skeleton';

export default function WatchlistView() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const { toast } = useToast();

  const fetchItems = () => {
    setLoading(true);
    fetch('/api/watchlist')
      .then(res => res.json())
      .then(data => {
        if (data.error) toast(data.error, 'error');
        else setItems(data);
        setLoading(false);
      })
      .catch(e => {
        toast(e.message, 'error');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const openAddModal = () => {
    setEditingItem(null);
    setIsModalOpen(true);
  };

  const openEditModal = (item: any) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const openDeleteModal = (id: number) => {
    setDeletingId(id);
    setIsDeleteModalOpen(true);
  };

  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deletingId) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/watchlist/${deletingId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      toast('Item removed from watchlist', 'success');
      setItems(items.filter(i => i.id !== deletingId));
      setIsDeleteModalOpen(false);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Watchlist</h2>
          <p className="text-gray-500 text-sm mt-1">Manage movies and series you want to track for releases.</p>
        </div>
        <Button onClick={openAddModal} className="shrink-0 gap-2">
          <Plus className="w-4 h-4" /> Add Movie / Series
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50/50 text-gray-900 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-4 font-semibold">Title</th>
                  <th className="px-6 py-4 font-semibold w-24">Year</th>
                  <th className="px-6 py-4 font-semibold w-32">Type</th>
                  <th className="px-6 py-4 font-semibold w-40">Added</th>
                  <th className="px-6 py-4 font-semibold w-24 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-48" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-12" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-6 w-20 rounded-full" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-24" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-8 w-16 ml-auto" /></td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center">
                      <div className="max-w-xs mx-auto space-y-4">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto">
                          <Play className="w-6 h-6 text-gray-400" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900">Your watchlist is empty</h3>
                        <p className="text-gray-500 text-sm">Search and add movies or series to start tracking downloads in real-time.</p>
                        <Button onClick={openAddModal} variant="outline" className="w-full">
                          Add your first item
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  items.map(item => (
                    <tr key={item.id} className="hover:bg-gray-50/50 transition-colors group">
                      <td className="px-6 py-4 font-medium text-gray-900">{item.title}</td>
                      <td className="px-6 py-4">{item.year}</td>
                      <td className="px-6 py-4">
                        <Badge variant={item.type.toLowerCase() as any}>{item.type}</Badge>
                      </td>
                      <td className="px-6 py-4 text-gray-500">{format(new Date(item.createdAt), 'MMM d, yyyy')}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" onClick={() => openEditModal(item)} aria-label="Edit item" className="h-8 w-8 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50">
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openDeleteModal(item.id)} aria-label="Delete item" className="h-8 w-8 text-gray-500 hover:text-red-600 hover:bg-red-50">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <WatchlistModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSaved={fetchItems}
        initialData={editingItem}
        existingItems={items}
      />

      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Remove Item">
        <div className="space-y-6">
          <p className="text-gray-600">Are you sure you want to remove this item from your watchlist? You will no longer receive notifications for it.</p>
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
            <Button variant="outline" onClick={() => setIsDeleteModalOpen(false)} disabled={isDeleting}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete} isLoading={isDeleting}>Remove Item</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

interface WatchlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  initialData?: any;
  existingItems?: any[];
}

function WatchlistModal({ isOpen, onClose, onSaved, initialData, existingItems = [] }: WatchlistModalProps) {
  const [activeTab, setActiveTab] = useState<'search' | 'manual'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingIds, setAddingIds] = useState<Record<string, boolean>>({});
  const [addedKeys, setAddedKeys] = useState<Record<string, boolean>>({});

  // Manual form state
  const [form, setForm] = useState({ title: '', year: new Date().getFullYear(), type: 'Movie' });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const searchTimeoutRef = useRef<any>(null);

  useEffect(() => {
    if (initialData) {
      setForm({ title: initialData.title, year: initialData.year, type: initialData.type });
      setActiveTab('manual');
    } else {
      setForm({ title: '', year: new Date().getFullYear(), type: 'Movie' });
      setActiveTab('search');
      setSearchQuery('');
      setSearchResults([]);
      setAddedKeys({});
    }
  }, [initialData, isOpen]);

  // Real-time debounced search
  useEffect(() => {
    if (activeTab !== 'search' || !isOpen || initialData) return;

    const trimmed = searchQuery.trim();
    if (!trimmed || trimmed.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/media/search?query=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setSearchResults(data);
        } else {
          setSearchResults([]);
        }
      } catch (err) {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, activeTab, isOpen, initialData]);

  // Check if item is already in watchlist
  const isAlreadyInWatchlist = (title: string, year: number, type: string) => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `${norm(title)}_${year}_${norm(type)}`;
    if (addedKeys[key]) return true;
    return existingItems.some(item => 
      norm(item.title) === norm(title) && 
      (Math.abs(item.year - year) <= 1 || !item.year) &&
      norm(item.type) === norm(type)
    );
  };

  // Add specific TMDB result directly to Watchlist
  const handleSelectResult = async (item: any) => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const itemKey = `${norm(item.title)}_${item.year}_${norm(item.type)}`;
    
    setAddingIds(prev => ({ ...prev, [itemKey]: true }));
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          year: item.year,
          type: item.type,
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setAddedKeys(prev => ({ ...prev, [itemKey]: true }));
      toast(`Added "${item.title} (${item.year})" to radar!`, 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setAddingIds(prev => ({ ...prev, [itemKey]: false }));
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const url = initialData ? `/api/watchlist/${initialData.id}` : '/api/watchlist';
      const method = initialData ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      toast(initialData ? 'Watchlist updated' : 'Added to watchlist', 'success');
      onSaved();
      onClose();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={initialData ? "Edit Watchlist Item" : "Add to Watchlist"}
    >
      <div className="space-y-4">
        {/* Tab Switcher (Only when adding new item) */}
        {!initialData && (
          <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-xl border border-gray-200">
            <button
              type="button"
              onClick={() => setActiveTab('search')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'search'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Search className="w-3.5 h-3.5" /> Real-time TMDB Search
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('manual')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'manual'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Edit2 className="w-3.5 h-3.5" /> Manual Entry
            </button>
          </div>
        )}

        {/* Tab 1: Real-time Search */}
        {activeTab === 'search' && !initialData && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search movie or TV show (e.g. Severance, Dune, Gladiator)..."
                className="w-full pl-10 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-xs"
              />
              {isSearching && (
                <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-600 animate-spin" />
              )}
            </div>

            {/* Results List */}
            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {isSearching && searchResults.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-500 flex flex-col items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                  <span>Searching TMDB library in real-time...</span>
                </div>
              )}

              {!isSearching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-500">
                  <p>No titles found matching &ldquo;{searchQuery}&rdquo;</p>
                  <button
                    onClick={() => {
                      setForm({ ...form, title: searchQuery, type: 'Movie' });
                      setActiveTab('manual');
                    }}
                    className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline"
                  >
                    Add &ldquo;{searchQuery}&rdquo; via manual entry instead
                  </button>
                </div>
              )}

              {searchQuery.trim().length < 2 && (
                <div className="py-6 text-center text-xs text-gray-400">
                  Type at least 2 characters to search movies and TV series
                </div>
              )}

              {searchResults.map((item, idx) => {
                const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
                const itemKey = `${norm(item.title)}_${item.year}_${norm(item.type)}`;
                const isAdded = isAlreadyInWatchlist(item.title, item.year, item.type);
                const isAdding = !!addingIds[itemKey];

                return (
                  <div
                    key={`${item.title}-${item.year}-${idx}`}
                    className="p-3 bg-gray-50/80 hover:bg-indigo-50/40 rounded-xl border border-gray-200/80 transition-all flex items-start gap-3.5 group"
                  >
                    {/* Poster */}
                    <div className="w-12 h-18 bg-gray-200 rounded-lg overflow-hidden shrink-0 shadow-xs border border-gray-200">
                      {item.poster ? (
                        <img
                          src={item.poster}
                          alt={item.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          {item.type === 'Series' ? <Tv className="w-5 h-5" /> : <Film className="w-5 h-5" />}
                        </div>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-gray-900 text-sm truncate max-w-[200px] sm:max-w-xs">
                          {item.title}
                        </span>
                        <span className="text-xs text-gray-500 font-medium">
                          ({item.year})
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                          item.type === 'Series' 
                            ? 'bg-purple-50 text-purple-700 border-purple-200' 
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                          {item.type === 'Series' ? '📺 TV Series' : '🎬 Movie'}
                        </span>
                        {item.voteAverage && item.voteAverage > 0 && (
                          <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-0.5">
                            <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-500" />
                            {item.voteAverage}
                          </span>
                        )}
                      </div>

                      {item.overview && (
                        <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                          {item.overview}
                        </p>
                      )}
                    </div>

                    {/* Add Action Button */}
                    <div className="shrink-0 self-center">
                      {isAdded ? (
                        <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-semibold flex items-center gap-1">
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          Tracked
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleSelectResult(item)}
                          disabled={isAdding}
                          className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs font-semibold gap-1"
                        >
                          {isAdding ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Plus className="w-3.5 h-3.5" />
                          )}
                          Track
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 2: Manual Form */}
        {(activeTab === 'manual' || initialData) && (
          <form onSubmit={handleManualSubmit} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-900">Title</label>
              <input 
                required 
                type="text" 
                value={form.title} 
                onChange={e => setForm({...form, title: e.target.value})} 
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-gray-400" 
                placeholder="e.g. Inception" 
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-900">Year</label>
                <input 
                  required 
                  type="number" 
                  min="1900"
                  max={new Date().getFullYear() + 5}
                  value={form.year} 
                  onChange={e => {
                    const val = parseInt(e.target.value);
                    setForm({...form, year: isNaN(val) ? '' as any : val});
                  }} 
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" 
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-900">Type</label>
                <select 
                  value={form.type} 
                  onChange={e => setForm({...form, type: e.target.value})} 
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                >
                  <option value="Movie">Movie</option>
                  <option value="Series">Series</option>
                  <option value="Anime">Anime</option>
                  <option value="Animation">Animation</option>
                  <option value="Documentary">Documentary</option>
                </select>
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" isLoading={saving}>
                {initialData ? 'Save Changes' : 'Add Item'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
