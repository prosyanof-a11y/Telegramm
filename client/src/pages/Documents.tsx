import React, { useState, useRef } from 'react';
import { trpc } from '../lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UploadCloud, FileText, Trash2, Play } from 'lucide-react';

export default function Documents() {
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { data: channels } = trpc.channels.list.useQuery();
  const { data: documents, refetch } = trpc.documents.list.useQuery(
    { channelId: selectedChannel },
    { enabled: !!selectedChannel }
  );

  const uploadDoc = trpc.documents.upload.useMutation({ onSuccess: () => refetch() });
  const deleteDoc = trpc.documents.delete.useMutation({ onSuccess: () => refetch() });
  const createPost = trpc.documents.createPost.useMutation({ onSuccess: () => refetch() });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChannel) return;

    // In a real app, you'd upload the file to a storage service (like Supabase Storage)
    // and then send the URL to the backend. For this example, we'll read it as text
    // if it's a txt file, or just send a mock content.
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      await uploadDoc.mutateAsync({
        channelId: selectedChannel,
        filename: file.name,
        content: content || 'Mock content for ' + file.name,
      });
    };
    
    if (file.name.endsWith('.txt')) {
      reader.readAsText(file);
    } else {
      // Mock for PDF/DOCX
      await uploadDoc.mutateAsync({
        channelId: selectedChannel,
        filename: file.name,
        content: 'Mock content for ' + file.name,
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Документы</h1>
        <div className="flex space-x-4">
          <Select value={selectedChannel} onValueChange={setSelectedChannel}>
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="Выберите канал" />
            </SelectTrigger>
            <SelectContent>
              {channels?.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".txt,.pdf,.docx"
            onChange={handleFileChange}
          />
          <Button 
            onClick={() => fileInputRef.current?.click()} 
            disabled={!selectedChannel || uploadDoc.isPending}
          >
            <UploadCloud className="mr-2 h-4 w-4" /> 
            {uploadDoc.isPending ? 'Загрузка...' : 'Загрузить файл'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Файлы канала</CardTitle></CardHeader>
        <CardContent>
          {!selectedChannel ? (
            <div className="text-center py-12 text-muted-foreground">
              Выберите канал для просмотра документов
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Имя файла</TableHead>
                  <TableHead>Дата загрузки</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents?.map(doc => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium flex items-center">
                      <FileText className="mr-2 h-4 w-4 text-blue-500" />
                      {doc.filename}
                    </TableCell>
                    <TableCell>{new Date(doc.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {doc.processed ? (
                        <span className="text-green-600 text-sm">Обработан</span>
                      ) : (
                        <span className="text-yellow-600 text-sm">Новый</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end space-x-2">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => createPost.mutate({ id: doc.id })}
                          disabled={createPost.isPending}
                        >
                          <Play className="mr-2 h-4 w-4" /> Создать пост
                        </Button>
                        <Button 
                          size="icon" 
                          variant="outline" 
                          className="text-red-600"
                          onClick={() => deleteDoc.mutate({ id: doc.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {documents?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      Нет загруженных документов
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
