import React, { useState } from 'react';
import { trpc } from '../lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

export default function Channels() {
  const { data: channels, refetch } = trpc.channels.list.useQuery();
  const createChannel = trpc.channels.create.useMutation({ onSuccess: () => refetch() });
  const updateChannel = trpc.channels.update.useMutation({ onSuccess: () => refetch() });

  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '', telegramChannelId: '', niche: '', tone: '', targetAudience: '',
    productDescription: '', exampleGoodPost: '', postFrequency: 1, active: true
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createChannel.mutateAsync(formData);
    setIsOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Каналы</h1>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button>Добавить канал</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Новый канал</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Название</Label>
                  <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                </div>
                <div className="space-y-2">
                  <Label>Telegram ID</Label>
                  <Input value={formData.telegramChannelId} onChange={e => setFormData({...formData, telegramChannelId: e.target.value})} required />
                </div>
                <div className="space-y-2">
                  <Label>Ниша</Label>
                  <Input value={formData.niche} onChange={e => setFormData({...formData, niche: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Тон</Label>
                  <Input value={formData.tone} onChange={e => setFormData({...formData, tone: e.target.value})} />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Целевая аудитория</Label>
                  <Textarea value={formData.targetAudience} onChange={e => setFormData({...formData, targetAudience: e.target.value})} />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Описание продукта</Label>
                  <Textarea value={formData.productDescription} onChange={e => setFormData({...formData, productDescription: e.target.value})} />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Пример хорошего поста</Label>
                  <Textarea value={formData.exampleGoodPost} onChange={e => setFormData({...formData, exampleGoodPost: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Постов в день</Label>
                  <Input type="number" value={formData.postFrequency} onChange={e => setFormData({...formData, postFrequency: parseInt(e.target.value)})} />
                </div>
                <div className="flex items-center space-x-2">
                  <Switch checked={formData.active} onCheckedChange={c => setFormData({...formData, active: c})} />
                  <Label>Активен</Label>
                </div>
              </div>
              <Button type="submit" className="w-full">Сохранить</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {channels?.map(channel => (
          <Card key={channel.id}>
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                {channel.name}
                <Switch 
                  checked={channel.active || false} 
                  onCheckedChange={(c) => updateChannel.mutate({ id: channel.id, active: c })}
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">Ниша: {channel.niche}</p>
              <p className="text-sm text-muted-foreground">Постов/день: {channel.postFrequency}</p>
              <div className="pt-4 flex space-x-2">
                <Button variant="outline" size="sm" className="w-full">Расписание</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
