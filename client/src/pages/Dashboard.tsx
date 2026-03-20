import React from 'react';
import { trpc } from '../lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function Dashboard() {
  const { data: channels } = trpc.channels.list.useQuery();
  const { data: posts } = trpc.posts.list.useQuery({});
  const { data: analytics } = trpc.analytics.summary.useQuery({});

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const postsToday = posts?.filter(p => new Date(p.createdAt) >= today).length || 0;
  const inQueue = posts?.filter(p => p.status === 'pending_approval').length || 0;
  const publishedWeek = analytics?.find(a => a.status === 'published')?.count || 0;

  // Mock data for chart
  const chartData = [
    { name: 'Пн', posts: 4 },
    { name: 'Вт', posts: 3 },
    { name: 'Ср', posts: 5 },
    { name: 'Чт', posts: 2 },
    { name: 'Пт', posts: 6 },
    { name: 'Сб', posts: 1 },
    { name: 'Вс', posts: 4 },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Дашборд</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Каналов</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{channels?.length || 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Постов сегодня</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{postsToday}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">В очереди</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{inQueue}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Опубликовано за неделю</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{publishedWeek}</div></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Публикации за 7 дней</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="posts" stroke="#8884d8" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Последние посты</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Текст</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Дата</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {posts?.slice(0, 5).map((post) => (
                  <TableRow key={post.id}>
                    <TableCell className="max-w-[200px] truncate">{post.text}</TableCell>
                    <TableCell>{post.status}</TableCell>
                    <TableCell>{new Date(post.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
