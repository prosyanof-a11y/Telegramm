import React, { useState } from 'react';
import { trpc } from '../lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Check, X, RefreshCw } from 'lucide-react';

export default function Generate() {
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [sourceType, setSourceType] = useState<'text' | 'document' | 'search'>('text');
  const [sourceContent, setSourceContent] = useState('');
  const [generatedPost, setGeneratedPost] = useState<any>(null);
  const [feedback, setFeedback] = useState('');

  const { data: channels } = trpc.channels.list.useQuery();
  const generatePost = trpc.posts.generate.useMutation({
    onSuccess: (data) => setGeneratedPost(data),
  });
  const approvePost = trpc.posts.approve.useMutation({
    onSuccess: () => setGeneratedPost(null),
  });
  const rejectPost = trpc.posts.reject.useMutation({
    onSuccess: () => setGeneratedPost(null),
  });
  const regeneratePost = trpc.posts.regenerate.useMutation({
    onSuccess: (data) => {
      setGeneratedPost(data);
      setFeedback('');
    },
  });

  const handleGenerate = () => {
    if (!selectedChannel || !sourceContent) return;
    generatePost.mutate({
      channelId: selectedChannel,
      sourceContent,
      withImage: true,
    });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Генерация поста</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Настройки генерации</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Канал</label>
              <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите канал" />
                </SelectTrigger>
                <SelectContent>
                  {channels?.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Tabs value={sourceType} onValueChange={(v: any) => setSourceType(v)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="text">Текст</TabsTrigger>
                <TabsTrigger value="document">Документ</TabsTrigger>
                <TabsTrigger value="search">Поиск</TabsTrigger>
              </TabsList>
              <TabsContent value="text" className="space-y-4 mt-4">
                <Textarea 
                  placeholder="Вставьте исходный текст, статью или идею для поста..." 
                  className="min-h-[200px]"
                  value={sourceContent}
                  onChange={(e) => setSourceContent(e.target.value)}
                />
              </TabsContent>
              <TabsContent value="document" className="mt-4">
                <div className="text-sm text-muted-foreground p-4 border rounded-md bg-gray-50">
                  Выберите документ из раздела "Документы" для генерации поста.
                </div>
              </TabsContent>
              <TabsContent value="search" className="mt-4">
                <div className="text-sm text-muted-foreground p-4 border rounded-md bg-gray-50">
                  Функция поиска в разработке.
                </div>
              </TabsContent>
            </Tabs>

            <Button 
              className="w-full" 
              onClick={handleGenerate}
              disabled={!selectedChannel || !sourceContent || generatePost.isPending}
            >
              {generatePost.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Генерирую...</>
              ) : (
                'Сгенерировать пост'
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Результат</CardTitle></CardHeader>
          <CardContent>
            {!generatedPost ? (
              <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground border-2 border-dashed rounded-lg">
                <p>Здесь появится сгенерированный пост</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-gray-50 p-4 rounded-lg border whitespace-pre-wrap">
                  {generatedPost.text}
                </div>
                
                {generatedPost.imageUrl && (
                  <div className="rounded-lg overflow-hidden border">
                    <img src={generatedPost.imageUrl} alt="Generated" className="w-full h-auto object-cover" />
                  </div>
                )}

                <div className="flex space-x-2">
                  <Button 
                    className="flex-1 bg-green-600 hover:bg-green-700" 
                    onClick={() => approvePost.mutate({ id: generatedPost.id })}
                    disabled={approvePost.isPending}
                  >
                    <Check className="mr-2 h-4 w-4" /> Одобрить
                  </Button>
                  <Button 
                    className="flex-1 bg-red-600 hover:bg-red-700" 
                    onClick={() => rejectPost.mutate({ id: generatedPost.id })}
                    disabled={rejectPost.isPending}
                  >
                    <X className="mr-2 h-4 w-4" /> Отклонить
                  </Button>
                </div>

                <div className="pt-4 border-t space-y-2">
                  <label className="text-sm font-medium">Что-то не так? Напишите замечания:</label>
                  <Textarea 
                    placeholder="Сделай текст короче, добавь эмодзи..." 
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => regeneratePost.mutate({ id: generatedPost.id, feedback })}
                    disabled={!feedback || regeneratePost.isPending}
                  >
                    {regeneratePost.isPending ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Переделываю...</>
                    ) : (
                      <><RefreshCw className="mr-2 h-4 w-4" /> Переделать</>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
