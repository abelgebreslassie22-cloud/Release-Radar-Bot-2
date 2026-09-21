import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Play, Loader2 } from 'lucide-react';
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
          <p className="text-gray-500 text-sm mt-1">Manage movies and series you want to track.</p>
        </div>
        <Button onClick={openAddModal} className="shrink-0 gap-2">
          <Plus className="w-4 h-4" /> Add Item
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
                        <p className="text-gray-500 text-sm">Add movies or series you want to track, and we'll notify you when they become available.</p>
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

function WatchlistModal({ isOpen, onClose, onSaved, initialData }: { isOpen: boolean, onClose: () => void, onSaved: () => void, initialData?: any }) {
  const [form, setForm] = useState({ title: '', year: new Date().getFullYear(), type: 'Movie' });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (initialData) {
      setForm({ title: initialData.title, year: initialData.year, type: initialData.type });
    } else {
      setForm({ title: '', year: new Date().getFullYear(), type: 'Movie' });
    }
  }, [initialData, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
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
    <Modal isOpen={isOpen} onClose={onClose} title={initialData ? "Edit Watchlist Item" : "Add to Watchlist"}>
      <form onSubmit={handleSubmit} className="space-y-5">
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
    </Modal>
  );
}
