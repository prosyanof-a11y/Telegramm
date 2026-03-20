import React, { useState } from 'react';
import { trpc } from '../lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, X, Edit2 } from 'lucide-react';

export default function Queue() {
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const { data: channels } = trpc.channels.list.useQuery();
  const { data: posts, refetch } = trpc.posts.list.useQuery(
    selectedChannel !== 'all' ? { channelId: selectedChannel } : {}
  );

  const approvePost = trpc.posts.approve.useMutation({ onSuccess: () => refetch() });
  const rejectPost = trpc.posts.reject.useMutation({ onSuccess: () => refetch() });

  const pendingPosts = posts?.filter(p => p.status === 'pending_approval') || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Очередь постов</h1>
        <Select value={selectedChannel} onValueChange={setSelectedChannel}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Все каналы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все каналы</SelectItem>
            {channels?.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader><CardTitle>Ожидают одобрения ({pendingPosts.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Канал</TableHead>
                <TableHead>Текст</TableHead>
                <TableHead>Медиа</TableHead>
                <TableHead>Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingPosts.map(post => {
                const channel = channels?.find(c => c.id === post.channelId);
                return (
                  <TableRow key={post.id}>
                    <TableCell className="font-medium">{channel?.name}</TableCell>
                    <TableCell className="max-w-md">
                      <div className="whitespace-pre-wrap text-sm">{post.text}</div>
                    </TableCell>
                    <TableCell>
                      {post.imageUrl && (
                        <img src={post.imageUrl} alt="Post media" className="w-20 h-20 object-cover rounded" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <Button size="icon" variant="outline" className="text-green-600" onClick={() => approvePost.mutate({ id: post.id })}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="outline" className="text-red-600" onClick={() => rejectPost.mutate({ id: post.id })}>
                          <X className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="outline" className="text-blue-600">
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {pendingPosts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    Нет постов, ожидающих одобрения
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
